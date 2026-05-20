import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const vagnawaCode = "9839115";
const hasVagnawaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vagnawaCode}.lua`));
const tunerCode = "983911501";
const nonTunerCode = "983911502";
const responderCode = "983911503";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;

describe.skipIf(!hasUpstreamScripts || !hasVagnawaScript)("Lua real script Vagnawa Synchro material stat burn", () => {
  it("restores material-check labels into Synchro summon ATK gain and BreakEffect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vagnawaCode}.lua`);
    expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e0:SetValue(s.valcheck)");
    expect(script).toContain("e0:SetOperation(s.matop)");
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsSynchroSummoned() end)");
    expect(script).toContain("e1:SetLabelObject(e0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,300)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,1,1-tp,300)");
    expect(script).toContain("local tuner_lv,nontuner_lv=e:GetLabelObject():GetLabel()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(nontuner_lv*300)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Damage(1-tp,tuner_lv*300,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: vagnawaCode, name: "Vagnawa the Moon-Eating Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 8, attack: 2500, defense: 2000 },
      { code: tunerCode, name: "Vagnawa Fixture Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, level: 3, attack: 800, defense: 1000 },
      { code: nonTunerCode, name: "Vagnawa Fixture Non-Tuner", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Vagnawa Fixture Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9839115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode], extra: [vagnawaCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const vagnawa = requireCard(session, vagnawaCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, tuner, 0);
    moveFaceUpAttack(session, nonTuner, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vagnawaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchroAction = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "synchroSummon" && action.uid === vagnawa.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid),
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, synchroAction!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === vagnawa.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: vagnawa.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        player: 0,
        sourceUid: vagnawa.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === vagnawa.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-3-1102",
        sourceUid: vagnawa.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: vagnawa.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x200000, targetUids: [vagnawa.uid], count: 1, player: 0, parameter: 300 },
          { category: 0x80000, targetUids: [], count: 1, player: 1, parameter: 300 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("vagnawa responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === vagnawa.uid), restoredChain.session.state)).toBe(4000);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7100);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: vagnawa.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("vagnawa responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
