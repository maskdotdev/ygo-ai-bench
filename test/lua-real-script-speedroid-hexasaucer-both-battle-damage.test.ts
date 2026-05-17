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
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Speedroid Hexasaucer both battle damage", () => {
  it("restores Hexasaucer and halves shared battle damage once for both players", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hexasaucerCode = "23792058";
    const attackerCode = "2379";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hexasaucerCode),
      { code: attackerCode, name: "Speedroid Hexasaucer Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 237, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [hexasaucerCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const hexasaucer = session.state.cards.find((card) => card.code === hexasaucerCode);
    expect(attacker).toBeDefined();
    expect(hexasaucer).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, hexasaucer!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hexasaucerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === hexasaucer!.uid && [206, 208].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 206,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-206",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:23792058:lua-4-206",
          "sourceUid": "p1-deck-23792058-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 208,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-208",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:23792058:lua-5-208",
          "sourceUid": "p1-deck-23792058-0",
          "target": [Function],
          "value": 2147483649,
        },
      ]
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === hexasaucer!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === hexasaucer!.uid && [206, 208].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 206,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-206",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:23792058:lua-4-206",
          "sourceUid": "p1-deck-23792058-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 208,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-208",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:23792058:lua-5-208",
          "sourceUid": "p1-deck-23792058-0",
          "target": [Function],
          "value": 2147483649,
        },
      ]
    `);

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 950, 1: 950 });
    expect(restored.session.state.players[0].lifePoints).toBe(7050);
    expect(restored.session.state.players[1].lifePoints).toBe(7050);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: hexasaucer!.uid,
        eventPlayer: 0,
        eventValue: 950,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker!.uid,
        eventPlayer: 1,
        eventValue: 950,
        eventReason: duelReason.battle,
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
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === hexasaucer!.uid)).toMatchObject({ location: "extraDeck", faceUp: true });
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
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
