import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D.D. Assailant battled trigger", () => {
  it("restores D.D. Assailant after damage calculation and banishes both battle participants", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const assailantCode = "70074904";
    const attackerCode = "7007";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === assailantCode),
      { code: attackerCode, name: "D.D. Assailant Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 700, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [assailantCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const assailant = session.state.cards.find((card) => card.code === assailantCode);
    expect(attacker).toBeDefined();
    expect(assailant).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, assailant!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(assailantCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === assailant!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({
      resultApplied: true,
      deferredBattleDestroyed: [{ uid: assailant!.uid, reasonPlayer: 0, reasonCardUid: attacker!.uid }],
    });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 100 });
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(7900);
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === assailant!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: assailant!.uid,
        sourceUid: assailant!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingBattle).toMatchObject({
      resultApplied: true,
      deferredBattleDestroyed: [{ uid: assailant!.uid, reasonPlayer: 0, reasonCardUid: attacker!.uid }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === assailant!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === assailant!.uid)).toMatchObject({ location: "banished", controller: 1 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "afterDamageCalculation", eventCode: 1138, eventUids: [attacker!.uid, assailant!.uid] }),
        expect.objectContaining({ eventName: "banished", eventCode: 1011, eventUids: [attacker!.uid, assailant!.uid] }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === assailant!.uid)).toMatchObject({ location: "banished", controller: 1 });
    expect(restored.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "battleDestroyed", eventCardUid: assailant!.uid })]),
    );
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
