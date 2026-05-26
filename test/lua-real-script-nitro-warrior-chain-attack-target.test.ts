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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nitro Warrior ChainAttack target", () => {
  it("restores its battled trigger and chain-attacks the selected position-changed monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nitroCode = "18013090";
    const firstTargetCode = "1801";
    const followupTargetCode = "1802";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nitroCode),
      { code: firstTargetCode, name: "Nitro Warrior First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: followupTargetCode, name: "Nitro Warrior Followup Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 180, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [nitroCode] }, 1: { main: [firstTargetCode, followupTargetCode] } });
    startDuel(session);

    const nitro = session.state.cards.find((card) => card.code === nitroCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const followupTarget = session.state.cards.find((card) => card.code === followupTargetCode);
    expect(nitro).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(followupTarget).toBeDefined();
    moveDuelCard(session.state, nitro!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, followupTarget!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nitroCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "trigger" && effect.code === 1138 && effect.sourceUid === nitro!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 4096,
        "code": 1138,
        "controller": 0,
        "cost": [Function],
        "description": 288209440,
        "event": "trigger",
        "id": "lua-7-1138",
        "luaTypeFlags": 129,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "property": 16,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:18013090:lua-7-1138",
        "sourceUid": "p0-extraDeck-18013090-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1138,
        "triggerEvent": "afterDamageCalculation",
        "triggerSourceOnly": true,
        "triggerTiming": "when",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === nitro!.uid && action.targetUid === firstTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponsesUntilTrigger(session);

    expect(session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense" });
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1138",
          "eventCardUid": "p0-extraDeck-18013090-0",
          "eventCode": 1138,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "afterDamageCalculation",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "extraDeck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-extraDeck-18013090-0",
            "p1-deck-1801-0",
          ],
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-extraDeck-18013090-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    expect(session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventCardUid: nitro!.uid,
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [nitro!.uid, firstTarget!.uid],
      },
    ]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: nitro!.uid,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.battle,
        eventReasonCardUid: nitro!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === nitro!.uid && action.effectId.endsWith("-1138"));
    expect(trigger).toBeDefined();
    const response = applyLuaRestoreResponse(restored, trigger!);
    expect(response.ok, response.error).toBe(true);
    resolveChainIfNeeded(restored);

    expect(restored.session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack" });
    expect(restored.session.state.currentAttack).toMatchObject({ attackerUid: nitro!.uid, targetUid: followupTarget!.uid });
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: nitro!.uid, targetUid: followupTarget!.uid });
    passBattleResponsesUntilDone(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(4400);
    expect(restored.session.state.battleDamage).toMatchObject({ 1: 1800 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: nitro!.uid,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.battle,
        eventReasonCardUid: nitro!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function resolveChainIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passBattleResponsesUntilTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    passBattleResponse(session);
  }
}

function passBattleResponsesUntilDone(session: DuelSession): void {
  while (session.state.pendingBattle) {
    passBattleResponse(session);
  }
}

function passBattleResponse(session: DuelSession): void {
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
