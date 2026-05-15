import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Divine Knight Ishzark battled trigger", () => {
  it("restores Divine Knight Ishzark after damage calculation and banishes the battle-destroyed target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ishzarkCode = "57902462";
    const targetCode = "5790";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ishzarkCode),
      { code: targetCode, name: "Ishzark Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 579, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ishzarkCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const ishzark = session.state.cards.find((card) => card.code === ishzarkCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(ishzark).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, ishzark!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ishzarkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ishzark!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({
      resultApplied: true,
      deferredBattleDestroyed: [{ uid: target!.uid, reasonPlayer: 0, reasonCardUid: ishzark!.uid }],
    });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.cards.find((card) => card.uid === ishzark!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: ishzark!.uid,
        sourceUid: ishzark!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingBattle).toMatchObject({
      resultApplied: true,
      deferredBattleDestroyed: [{ uid: target!.uid, reasonPlayer: 0, reasonCardUid: ishzark!.uid }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === ishzark!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === ishzark!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: ishzark!.uid,
        eventUids: [ishzark!.uid, target!.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ishzark!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "banished",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);

    passBattleResponses(restored.session);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", controller: 1 });
    expect(restored.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "battleDestroyed", eventCardUid: target!.uid })]),
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
