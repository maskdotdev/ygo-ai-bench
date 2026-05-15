import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const zarcCode = "13331639";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Supreme King Gate Zero damage prevention", () => {
  it("restores its Pendulum Zone damage-zero callback while Z-ARC is face-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gateZeroCode = "96227613";
    const fireCode = "46918794";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gateZeroCode || card.code === fireCode),
      { code: zarcCode, name: "Supreme King Z-ARC Fixture", kind: "monster", typeFlags: typeMonster, level: 12, attack: 4000, defense: 4000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9622, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gateZeroCode, zarcCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const gateZero = session.state.cards.find((card) => card.code === gateZeroCode);
    const zarc = session.state.cards.find((card) => card.code === zarcCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    expect(gateZero).toBeDefined();
    expect(zarc).toBeDefined();
    expect(fire).toBeDefined();
    moveDuelCard(session.state, gateZero!.uid, "spellTrapZone", 0);
    gateZero!.position = "faceUpAttack";
    gateZero!.faceUp = true;
    moveDuelCard(session.state, zarc!.uid, "monsterZone", 0);
    zarc!.position = "faceUpAttack";
    zarc!.faceUp = true;
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gateZeroCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === gateZero!.uid && effect.code === 82)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 82,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-3-82",
        "label": 0,
        "lifePointValue": [Function],
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "property": 2048,
        "range": [
          "spellTrapZone",
        ],
        "registryKey": "lua:96227613:lua-3-82",
        "sourceUid": "p0-deck-96227613-0",
        "statValue": [Function],
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    const fireActivation = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid === fire!.uid);
    expect(fireActivation, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, fireActivation!);

    const restoredFire = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredFire.restoreComplete, restoredFire.incompleteReasons.join("; ")).toBe(true);
    expect(restoredFire.missingRegistryKeys).toEqual([]);
    expect(restoredFire.missingChainLimitRegistryKeys).toEqual([]);
    const player = restoredFire.session.state.waitingFor ?? restoredFire.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restoredFire, player)).toEqual(getGroupedDuelLegalActions(restoredFire.session, player));
    expect(getLuaRestoreLegalActionGroups(restoredFire, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredFire, player));
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt" && event.eventPlayer === 0)).toEqual([]);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: fire!.uid,
        eventReasonEffectId: 8,
      },
    ]);
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
