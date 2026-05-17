import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Key Mouse battle-destroyed search", () => {
  it("restores EVENT_BATTLE_DESTROYED Deck search-to-hand and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const keyMouseCode = "135598";
    const opponentCode = "135599";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === keyMouseCode),
      { code: opponentCode, name: "Key Mouse Battle Destroyer", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1355, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [keyMouseCode, keyMouseCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const keyMice = session.state.cards.filter((card) => card.code === keyMouseCode && card.owner === 0);
    const opponent = session.state.cards.find((card) => card.code === opponentCode);
    expect(keyMice).toHaveLength(2);
    expect(opponent).toBeDefined();
    const battleKeyMouse = keyMice[0]!;
    const deckKeyMouse = keyMice[1]!;
    moveDuelCard(session.state, battleKeyMouse.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(keyMouseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getDuelLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === battleKeyMouse.uid && action.targetUid === opponent!.uid,
    );
    expect(attack, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyDuelAction(session, attack!);
    passBattleResponses(session);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredTrigger, 0)).toEqual(getDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTrigger, 0));
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        player: 0,
        effectId: "lua-1-1140",
        sourceUid: battleKeyMouse.uid,
        triggerBucket: "turnOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleKeyMouse.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponent!.uid,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === battleKeyMouse.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const triggered = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(triggered.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggered.legalActions);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === battleKeyMouse.uid)).toMatchObject({
      location: "graveyard",
      reasonCardUid: opponent!.uid,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === deckKeyMouse.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: deckKeyMouse.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: battleKeyMouse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToHandConfirmed")).toEqual([
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: deckKeyMouse.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: battleKeyMouse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventUids: [deckKeyMouse.uid],
        eventValue: 1,
      },
    ]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
    applyDuelAction(session, pass!);
  }
}

function applyDuelAction(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
