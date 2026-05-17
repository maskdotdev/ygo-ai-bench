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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Predaplant Sarraceniant battled trigger", () => {
  it("restores its EVENT_BATTLED trigger and destroys the monster it battled", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sarraceniantCode = "53819028";
    const battleTargetCode = "5381";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sarraceniantCode),
      { code: battleTargetCode, name: "Sarraceniant Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 0, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 538, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sarraceniantCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const sarraceniant = session.state.cards.find((card) => card.code === sarraceniantCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    expect(sarraceniant).toBeDefined();
    expect(battleTarget).toBeDefined();
    moveDuelCard(session.state, sarraceniant!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sarraceniantCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === sarraceniant!.uid && action.targetUid === battleTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({
      attackerUid: sarraceniant!.uid,
      targetUid: battleTarget!.uid,
      deferredBattleDestroyed: [
        {
          uid: battleTarget!.uid,
          reasonPlayer: 0,
          reasonCardUid: sarraceniant!.uid,
        },
      ],
      resultApplied: true,
    });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 100 });
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(7900);
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1138",
        eventCardUid: sarraceniant!.uid,
        eventCode: 1138,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "afterDamageCalculation",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [sarraceniant!.uid, battleTarget!.uid],
        id: "trigger-5-1",
        player: 0,
        sourceUid: sarraceniant!.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === sarraceniant!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(triggered.legalActions).toEqual(getLegalActions(restored.session, triggered.state.waitingFor!));
    expect(triggered.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggered.state.waitingFor!));
    expect(triggered.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggered.legalActions);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === sarraceniant!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sarraceniant!.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: sarraceniant!.uid,
        eventUids: [sarraceniant!.uid, battleTarget!.uid],
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: battleTarget!.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sarraceniant!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
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
