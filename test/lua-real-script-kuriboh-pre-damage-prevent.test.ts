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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kuriboh pre-damage prevention", () => {
  it("restores its before-damage hand Quick Effect and prevents battle damage after self-discard cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kuribohCode = "40640057";
    const attackerCode = "40640058";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kuribohCode),
      { code: attackerCode, name: "Kuriboh Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 406, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kuribohCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const kuriboh = session.state.cards.find((card) => card.code === kuribohCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(kuriboh).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, kuriboh!.uid, "hand", 0);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kuribohCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilBattleWindow(session, "beforeDamageCalculation");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restored.session.state.eventHistory).toContainEqual(expect.objectContaining({
      eventName: "beforeDamageCalculation",
      eventCode: 1134,
    }));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === kuriboh!.uid)).toMatchObject({
      event: "quick",
      triggerEvent: "beforeDamageCalculation",
      range: ["hand"],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === kuriboh!.uid)).toBe(false);

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === kuriboh!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === kuriboh!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restored.session.state.effects.find((effect) => effect.code === 201 && effect.sourceUid === kuriboh!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 201,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-201",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 2048,
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
        "registryKey": "lua:40640057:lua-2-201",
        "reset": {
          "flags": 1073741856,
        },
        "sourceUid": "p0-deck-40640057-0",
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
      }
    `);

    passRestoredBattleResponses(restored);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt" && event.eventPlayer === 0)).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function passUntilBattleWindow(session: DuelSession, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
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
