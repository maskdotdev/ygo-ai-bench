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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Giant Rat mutual battle-destroyed SEGOC", () => {
  it("restores simultaneous optional EVENT_BATTLE_DESTROYED recruiters as one chain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const giantRatCode = "97017120";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giantRatCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 970, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [giantRatCode, giantRatCode] }, 1: { main: [giantRatCode, giantRatCode] } });
    startDuel(session);

    const p0Rats = session.state.cards.filter((card) => card.code === giantRatCode && card.owner === 0);
    const p1Rats = session.state.cards.filter((card) => card.code === giantRatCode && card.owner === 1);
    expect(p0Rats).toHaveLength(2);
    expect(p1Rats).toHaveLength(2);
    const p0BattleRat = p0Rats[0]!;
    const p0DeckRat = p0Rats[1]!;
    const p1BattleRat = p1Rats[0]!;
    const p1DeckRat = p1Rats[1]!;
    moveDuelCard(session.state, p0BattleRat.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, p1BattleRat.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(giantRatCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === p0BattleRat.uid && action.targetUid === p1BattleRat.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === p0BattleRat.uid)).toMatchObject({ location: "graveyard", reasonCardUid: p1BattleRat.uid });
    expect(session.state.cards.find((card) => card.uid === p1BattleRat.uid)).toMatchObject({ location: "graveyard", reasonCardUid: p0BattleRat.uid });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: p0BattleRat.uid,
        sourceUid: p0BattleRat.uid,
        eventUids: [p0BattleRat.uid, p1BattleRat.uid],
      }),
      expect.objectContaining({
        player: 1,
        triggerBucket: "opponentOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: p1BattleRat.uid,
        sourceUid: p1BattleRat.uid,
        eventUids: [p0BattleRat.uid, p1BattleRat.uid],
      }),
    ]);
    expect(queryPublicState(session).pendingTriggerBuckets).toMatchObject([
      { player: 0, triggerBucket: "turnOptional" },
      { player: 1, triggerBucket: "opponentOptional" },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const p0Trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === p0BattleRat.uid);
    expect(p0Trigger).toBeDefined();
    let response = applyLuaRestoreResponse(restored, p0Trigger!);
    expect(response.ok, response.error).toBe(true);
    expect(restored.session.state.chain).toEqual([expect.objectContaining({ player: 0, sourceUid: p0BattleRat.uid })]);
    expect(restored.session.state.cards.find((card) => card.uid === p0DeckRat.uid)).toMatchObject({ location: "deck" });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toMatchObject([{ player: 1, triggerBucket: "opponentOptional" }]);

    const p1Trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === p1BattleRat.uid);
    expect(p1Trigger).toBeDefined();
    response = applyLuaRestoreResponse(restored, p1Trigger!);
    expect(response.ok, response.error).toBe(true);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === p0BattleRat.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === p1BattleRat.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === p0DeckRat.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack" });
    expect(restored.session.state.cards.find((card) => card.uid === p1DeckRat.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack" });
    expect(
      restored.session.state.eventHistory
        .filter((event) => event.eventName === "specialSummoned")
        .map((event) => event.eventCardUid)
        .slice(-2),
    ).toEqual([p1DeckRat.uid, p0DeckRat.uid]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
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
