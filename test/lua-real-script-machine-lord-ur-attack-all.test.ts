import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Machine Lord Ur attack all", () => {
  it("restores Machine Lord Ur and lets it attack each opponent monster once without granting a direct attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const urCode = "96938777";
    const firstTargetCode = "9693";
    const secondTargetCode = "9694";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === urCode),
      { code: firstTargetCode, name: "First Ur Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Second Ur Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 193, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [urCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const ur = session.state.cards.find((card) => card.code === urCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const secondTarget = session.state.cards.find((card) => card.code === secondTargetCode);
    expect(ur).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, ur!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(urCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === ur!.uid && [193, 200].includes(effect.code))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 193,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-193",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:96938777:lua-1-193",
          "sourceUid": "p0-deck-96938777-0",
          "target": [Function],
          "value": 1,
        },
        {
          "canActivate": [Function],
          "code": 200,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-200",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:96938777:lua-2-200",
          "sourceUid": "p0-deck-96938777-0",
          "target": [Function],
        },
      ]
    `);

    const openingActions = getLegalActions(session, 0);
    expect(hasAttack(openingActions, ur!.uid, firstTarget!.uid)).toBe(true);
    expect(hasAttack(openingActions, ur!.uid, secondTarget!.uid)).toBe(true);
    expect(hasDirectAttack(openingActions, ur!.uid)).toBe(false);

    const firstAttack = openingActions.find((action) => action.type === "declareAttack" && action.attackerUid === ur!.uid && action.targetUid === firstTarget!.uid);
    expect(firstAttack).toBeDefined();
    applyAndAssert(session, firstAttack!);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === ur!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(session.state.players[0].lifePoints).toBe(8000);
    expect(session.state.players[1].lifePoints).toBe(8000);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === ur!.uid && [193, 200].includes(effect.code))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 193,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-193",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:96938777:lua-1-193",
          "sourceUid": "p0-deck-96938777-0",
          "target": [Function],
          "value": 1,
        },
        {
          "canActivate": [Function],
          "code": 200,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-200",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:96938777:lua-2-200",
          "sourceUid": "p0-deck-96938777-0",
          "target": [Function],
        },
      ]
    `);
    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(restoredActions, ur!.uid, secondTarget!.uid)).toBe(true);
    expect(hasAttack(restoredActions, ur!.uid, firstTarget!.uid)).toBe(false);
    expect(hasDirectAttack(restoredActions, ur!.uid)).toBe(false);

    const secondAttack = getLegalActions(restored.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ur!.uid && action.targetUid === secondTarget!.uid);
    expect(secondAttack).toBeDefined();
    applyAndAssert(restored.session, secondAttack!);
    passBattleResponses(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === secondTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ur!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    const finalActions = getLegalActions(restored.session, 0);
    expect(finalActions.some((action) => action.type === "declareAttack" && action.attackerUid === ur!.uid)).toBe(false);
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
}

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
