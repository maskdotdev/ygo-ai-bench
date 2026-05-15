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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Performage Trapeze Magician damage prevention", () => {
  it("restores its ATK-threshold effect-damage prevention", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const trapezeCode = "17016362";
    const fireCode = "46918794";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trapezeCode || card.code === fireCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1701, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [trapezeCode] }, 1: { main: [fireCode] } });
    startDuel(session);

    const trapeze = session.state.cards.find((card) => card.code === trapezeCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    expect(trapeze).toBeDefined();
    expect(fire).toBeDefined();
    moveDuelCard(session.state, trapeze!.uid, "monsterZone", 0);
    trapeze!.position = "faceUpAttack";
    trapeze!.faceUp = true;
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = { readScript: (name: string) => workspace.readScript(name) };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trapezeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(
      restored.session.state.effects.filter((effect) => effect.sourceUid === trapeze!.uid && effect.code === 82),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 82,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-82",
          "lifePointValue": [Function],
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 2048,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:17016362:lua-2-82",
          "sourceUid": "p0-extraDeck-17016362-0",
          "statValue": [Function],
          "target": [Function],
          "targetRange": [
            1,
            0,
          ],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
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
        eventReasonEffectId: 5,
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
