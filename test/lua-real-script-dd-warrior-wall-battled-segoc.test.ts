import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D.D. Warrior and Wall of Illusion battled SEGOC", () => {
  it("restores simultaneous EVENT_BATTLED mandatory triggers and respects chain order battle relation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const warriorCode = "37043180";
    const wallCode = "13945283";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warriorCode || card.code === wallCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 370, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [warriorCode] }, 1: { main: [wallCode] } });
    startDuel(session);

    const warrior = session.state.cards.find((card) => card.code === warriorCode);
    const wall = session.state.cards.find((card) => card.code === wallCode);
    expect(warrior).toBeDefined();
    expect(wall).toBeDefined();
    moveDuelCard(session.state, warrior!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, wall!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(warriorCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(wallCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === warrior!.uid && action.targetUid === wall!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({
      resultApplied: true,
      deferredBattleDestroyed: [{ uid: wall!.uid, reasonPlayer: 0, reasonCardUid: warrior!.uid }],
    });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 200 });
    expect(session.state.players[1].lifePoints).toBe(7800);
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, triggerBucket: "turnMandatory", eventName: "afterDamageCalculation", eventCode: 1138, sourceUid: warrior!.uid }),
      expect.objectContaining({ player: 1, triggerBucket: "opponentMandatory", eventName: "afterDamageCalculation", eventCode: 1138, sourceUid: wall!.uid }),
    ]);
    expect(queryPublicState(session).pendingTriggerBuckets).toMatchObject([
      { player: 0, triggerBucket: "turnMandatory" },
      { player: 1, triggerBucket: "opponentMandatory" },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const warriorTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === warrior!.uid);
    expect(warriorTrigger).toBeDefined();
    let response = applyLuaRestoreResponse(restored, warriorTrigger!);
    expect(response.ok, response.error).toBe(true);
    expect(restored.session.state.chain).toEqual([expect.objectContaining({ sourceUid: warrior!.uid })]);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toMatchObject([{ player: 1, triggerBucket: "opponentMandatory" }]);

    const wallTrigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === wall!.uid);
    expect(wallTrigger).toBeDefined();
    response = applyLuaRestoreResponse(restored, wallTrigger!);
    expect(response.ok, response.error).toBe(true);
    passRestoredChainResponses(restored);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === warrior!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === wall!.uid)).toMatchObject({ location: "banished", controller: 1 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "afterDamageCalculation", eventCode: 1138, eventUids: [warrior!.uid, wall!.uid] }),
        expect.objectContaining({ eventName: "sentToHand", eventCardUid: warrior!.uid }),
        expect.objectContaining({ eventName: "banished", eventCardUid: wall!.uid }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === warrior!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === wall!.uid)).toMatchObject({ location: "banished", controller: 1 });
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    passNextBattleResponse(session);
  }
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    passNextBattleResponse(session);
  }
}

function passNextBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLegalActions(session, player).find((action) => action.type === passType);
  expect(pass).toBeDefined();
  applyAndAssert(session, pass!);
}

function passRestoredChainResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    if (!pass) break;
    const response = applyLuaRestoreResponse(restored, pass);
    expect(response.ok, response.error).toBe(true);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
