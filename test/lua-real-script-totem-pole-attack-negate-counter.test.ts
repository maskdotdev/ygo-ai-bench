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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Totem Pole attack negate counter", () => {
  it("restores Totem Pole's attack trigger cost, negates the attack, and adds a counter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const totemPoleCode = "47873397";
    const attackerCode = "4788";
    const targetCode = "4789";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === totemPoleCode),
      { code: attackerCode, name: "Totem Pole Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: targetCode, name: "Totem Pole Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4788, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [totemPoleCode, targetCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const totemPole = session.state.cards.find((card) => card.code === totemPoleCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(attacker).toBeDefined();
    expect(totemPole).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, totemPole!.uid, "spellTrapZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(totemPoleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "trigger" && effect.code === 1130 && effect.sourceUid === totemPole!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 8388608,
        "code": 1130,
        "controller": 1,
        "cost": [Function],
        "description": 765974352,
        "event": "trigger",
        "id": "lua-4-1130",
        "luaConditionDescriptor": "condition:turn-player:opponent",
        "luaTypeFlags": 130,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "range": [
          "spellTrapZone",
        ],
        "registryKey": "lua:47873397:lua-4-1130",
        "sourceUid": "p1-deck-47873397-0",
        "target": [Function],
        "triggerCode": 1130,
        "triggerEvent": "attackDeclared",
        "triggerTiming": "when",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-4-1130",
          "eventCardUid": "p0-deck-4788-0",
          "eventCode": 1130,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "attackDeclared",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-deck-4788-0",
            "p1-deck-4789-1",
          ],
          "id": "trigger-3-1",
          "player": 1,
          "sourceUid": "p1-deck-47873397-0",
          "triggerBucket": "opponentOptional",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-4-1130",
          "eventCardUid": "p0-deck-4788-0",
          "eventCode": 1130,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "attackDeclared",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-deck-4788-0",
            "p1-deck-4789-1",
          ],
          "id": "trigger-3-1",
          "player": 1,
          "sourceUid": "p1-deck-47873397-0",
          "triggerBucket": "opponentOptional",
        },
      ]
    `);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const negate = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === totemPole!.uid);
    expect(negate).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, negate!);
    expect(activated.ok, activated.error).toBe(true);
    resolveChainIfNeeded(restored);

    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.cards.find((card) => card.uid === totemPole!.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 1,
      counters: { [0x20f]: 1 },
    });
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled")).toEqual([
      {
        eventName: "attackDisabled",
        eventCode: 1142,
        eventCardUid: attacker!.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: totemPole!.uid,
        eventReasonEffectId: 4,
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === totemPole!.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: totemPole!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: totemPole!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
