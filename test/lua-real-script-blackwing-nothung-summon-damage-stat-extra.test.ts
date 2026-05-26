import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const nothungCode = "95040215";
const blackwingRegularCode = "95040216";
const blackwingExtraCode = "95040217";
const targetCode = "95040218";
const responderCode = "95040219";
const setBlackwing = 0x33;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blackwing Nothung summon damage stat extra summon", () => {
  it("restores its Special Summon damage/stat trigger and field extra Blackwing Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nothungCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(800)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("e2:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_BLACKWING))");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nothungCode),
      { code: blackwingRegularCode, name: "Blackwing Fixture Regular", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 4, attack: 1200, defense: 1000 },
      { code: blackwingExtraCode, name: "Blackwing Fixture Extra", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 4, attack: 1300, defense: 1000 },
      { code: targetCode, name: "Blackwing Nothung Fixture Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1500 },
      { code: responderCode, name: "Blackwing Nothung Fixture Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 95040215, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blackwingRegularCode, blackwingExtraCode], extra: [nothungCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const nothung = requireCard(session, nothungCode);
    const regular = requireCard(session, blackwingRegularCode);
    const extra = requireCard(session, blackwingExtraCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, nothung.uid, "hand", 0);
    moveDuelCard(session.state, regular.uid, "hand", 0);
    moveDuelCard(session.state, extra.uid, "hand", 0);
    moveFaceUpAttack(session, target.uid, 1);
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
    expect(host.loadCardScript(Number(nothungCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, nothung.uid, 0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === nothung.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1102",
        eventCardUid: nothung.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: nothung.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nothung.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1102",
        sourceUid: nothung.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: nothung.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x80000, count: 0, parameter: 800, player: 1, targetUids: [] },
          { category: 0x200000, count: 1, parameter: 800, player: 1, targetUids: [] },
          { category: 0x400000, count: 1, parameter: 800, player: 1, targetUids: [] },
        ],
        targetParam: 800,
        targetPlayer: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("blackwing nothung responder resolved");
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7200);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(700);
    expect(currentDefense(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(700);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toContainEqual({
      eventName: "damageDealt",
      eventCode: 1111,
      eventPlayer: 1,
      eventValue: 800,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: nothung.uid,
      eventReasonEffectId: 3,
    });

    const restoredExtraSummon = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredExtraSummon);
    expectRestoredLegalActions(restoredExtraSummon, 0);
    const regularSummon = getLuaRestoreLegalActions(restoredExtraSummon, 0).find((action) => action.type === "normalSummon" && action.uid === regular.uid);
    expect(regularSummon, JSON.stringify(getLuaRestoreLegalActions(restoredExtraSummon, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredExtraSummon, regularSummon!);
    expect(restoredExtraSummon.session.state.players[0].normalSummonAvailable).toBe(false);

    const restoredAfterRegularSummon = restoreDuelWithLuaScripts(serializeDuel(restoredExtraSummon.session), source, reader);
    expectCleanRestore(restoredAfterRegularSummon);
    expectRestoredLegalActions(restoredAfterRegularSummon, 0);
    const extraSummon = getLuaRestoreLegalActions(restoredAfterRegularSummon, 0).find((action) => action.type === "normalSummon" && action.uid === extra.uid);
    expect(extraSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterRegularSummon, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredAfterRegularSummon, extraSummon!);
    expect(restoredAfterRegularSummon.session.state.activityCounts[0].normalSummon).toBe(2);
    expect(restoredAfterRegularSummon.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned").map((event) => event.eventCardUid)).toEqual([
      regular.uid,
      extra.uid,
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("blackwing nothung responder resolved") end)
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
