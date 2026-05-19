import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const spellReactorCode = "15175429";
const sparksCode = "76103675";
const categoryDamage = 0x80000;
const effectFlagDamageStep = 0x4000;
const effectFlagDamageCal = 0x8000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spell Reactor chain destroy damage", () => {
  it("restores its spell-activation chain response that destroys the source and deals damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const spellReactorScript = workspace.readScript(`c${spellReactorCode}.lua`);
    expect(spellReactorScript).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_DESTROY)");
    expect(spellReactorScript).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(spellReactorScript).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(spellReactorScript).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(spellReactorScript).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect()");
    expect(spellReactorScript).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,0,0)");
    expect(spellReactorScript).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,800)");
    expect(spellReactorScript).toContain("Duel.Destroy(eg,REASON_EFFECT)~=0");

    const sparksScript = workspace.readScript(`c${sparksCode}.lua`);
    expect(sparksScript).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(sparksScript).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [spellReactorCode, sparksCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1517, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sparksCode] }, 1: { main: [spellReactorCode] } });
    startDuel(session);

    const sparks = requireCard(session, sparksCode);
    const spellReactor = requireCard(session, spellReactorCode);
    moveDuelCard(session.state, sparks.uid, "hand", 0);
    const reactorOnField = moveDuelCard(session.state, spellReactor.uid, "monsterZone", 1);
    reactorOnField.faceUp = true;
    reactorOnField.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sparksCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(spellReactorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === spellReactor.uid && effect.code === 1027)).toMatchObject({
      code: 1027,
      event: "quick",
      property: effectFlagDamageStep | effectFlagDamageCal,
      sourceUid: spellReactor.uid,
    });

    const activateSparks = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sparks.uid);
    expect(activateSparks, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activateSparks!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: categoryDamage, count: 0, parameter: 200, player: 1, targetUids: [] }],
      player: 0,
      sourceUid: sparks.uid,
      targetParam: 200,
      targetPlayer: 1,
    });

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const reactorResponse = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "activateEffect" && action.uid === spellReactor.uid);
    expect(reactorResponse, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    expect(reactorResponse).toMatchObject({ effectId: "lua-2-1027", player: 1, uid: spellReactor.uid, windowKind: "chainResponse" });
    applyRestoredActionAndAssert(restoredResponse, reactorResponse!);
    expect(restoredResponse.session.state.chain).toHaveLength(0);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === spellReactor.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === sparks.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: spellReactor.uid,
      reasonEffectId: 2,
      reasonPlayer: 1,
    });
    expect(restoredResponse.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredResponse.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: sparks.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: spellReactor.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: spellReactor.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 200,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sparks.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredResolved.session.state.players[1].lifePoints).toBe(7800);
  });
});

function expectCleanRestore(restored: LuaSnapshotRestoreResult): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): void {
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyRestoredActionAndAssert(restored: LuaSnapshotRestoreResult, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
