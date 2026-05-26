import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setSixSamurai = 0x3d;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Six Samurai Kamon destroy replace attack lock", () => {
  it("restores targeted Spell/Trap destruction, attack-announcement oath cost, and Six Samurai destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kamonCode = "90397998";
    const allyCode = "903979980";
    const spellTargetCode = "903979981";
    const responderCode = "903979982";
    const script = workspace.readScript(`c${kamonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("e1:SetCost(s.descost)");
    expect(script).toContain("e1:SetTarget(s.destg)");
    expect(script).toContain("e1:SetOperation(s.desop)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.repfilter,tp,LOCATION_MZONE,0,1,1,c,e)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT|REASON_REPLACE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kamonCode),
      { code: allyCode, name: "Kamon Six Samurai Ally", kind: "monster", typeFlags: typeMonster, setcodes: [setSixSamurai], level: 4, attack: 1500, defense: 1200 },
      { code: spellTargetCode, name: "Kamon Face-up Spell Target", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Kamon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90397998, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kamonCode, allyCode, spellTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const kamon = requireCard(session, kamonCode);
    const ally = requireCard(session, allyCode);
    const spellTarget = requireCard(session, spellTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, kamon.uid, "monsterZone", 0);
    kamon.position = "faceUpAttack";
    kamon.faceUp = true;
    moveDuelCard(session.state, ally.uid, "monsterZone", 0);
    ally.sequence = 1;
    ally.position = "faceUpAttack";
    ally.faceUp = true;
    moveDuelCard(session.state, spellTarget.uid, "spellTrapZone", 1);
    spellTarget.position = "faceUpAttack";
    spellTarget.faceUp = true;
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
    expect(host.loadCardScript(Number(kamonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === kamon.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: kamon.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [spellTarget.uid],
        operationInfos: [{ category: 0x1, targetUids: [spellTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    expect(restoredActivation.session.state.effects.some((effect) => effect.sourceUid === kamon.uid && effect.code === 86)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("kamon responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === spellTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: kamon.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === spellTarget.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: spellTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: kamon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const kamonCanAttackActions = getLuaRestoreLegalActions(restoredChain, 0)
      .filter((action) => action.type === "declareAttack" && action.attackerUid === kamon.uid);
    expect(kamonCanAttackActions).toEqual([]);

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, kamon.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true },
    ]);
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === kamon.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === ally.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
      reasonPlayer: 0,
      reasonCardUid: kamon.uid,
    });
    expect(restoredReplacement.session.state.log.filter((entry) => entry.action === "destroyReplace")).toEqual([
      { step: 7, action: "destroyReplace", player: 0, card: kamon.name, detail: "Destruction replaced" },
    ]);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("kamon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAndAssert(restored, pass!);
  }
}
