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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Number C96 also battle damage", () => {
  it("restores Number C96 and applies also battle damage to the opponent", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkStormCode = "77205367";
    const targetCode = "7720";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkStormCode),
      { code: targetCode, name: "Number C96 Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 772, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkStormCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const darkStorm = session.state.cards.find((card) => card.code === darkStormCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(darkStorm).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, darkStorm!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkStormCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 207 && effect.sourceUid === darkStorm!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 207,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-3-207",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:77205367:lua-3-207",
        "sourceUid": "p0-deck-77205367-0",
        "target": [Function],
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === darkStorm!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 207 && effect.sourceUid === darkStorm!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 207,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-3-207",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:77205367:lua-3-207",
        "sourceUid": "p0-deck-77205367-0",
        "target": [Function],
      }
    `);

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 800, 1: 800 });
    expect(restored.session.state.players[0].lifePoints).toBe(7200);
    expect(restored.session.state.players[1].lifePoints).toBe(7200);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: target!.uid,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonCardUid: target!.uid,
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
          position: "faceUpDefense",
          sequence: 0,
        },
      },
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: darkStorm!.uid,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonCardUid: darkStorm!.uid,
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
    expect(restored.session.state.cards.find((card) => card.uid === darkStorm!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
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
