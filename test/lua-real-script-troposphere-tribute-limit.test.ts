import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, tributeSummonDuelCard } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Troposphere tribute limit", () => {
  it("restores target-owned EFFECT_TRIBUTE_LIMIT material race checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const troposphereCode = "72144675";
    const wingedBeastCode = "900000253";
    const dragonCode = "900000254";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === troposphereCode),
      { code: wingedBeastCode, name: "Winged Beast Tribute", kind: "monster", typeFlags: 0x1, level: 4, race: 0x200, attack: 1200, defense: 1000 },
      { code: dragonCode, name: "Dragon Tribute", kind: "monster", typeFlags: 0x1, level: 4, race: 0x2000, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 721, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [troposphereCode, wingedBeastCode, dragonCode] }, 1: { main: [] } });
    startDuel(session);

    const troposphere = session.state.cards.find((card) => card.code === troposphereCode);
    const wingedBeast = session.state.cards.find((card) => card.code === wingedBeastCode);
    const dragon = session.state.cards.find((card) => card.code === dragonCode);
    expect(troposphere).toBeDefined();
    expect(wingedBeast).toBeDefined();
    expect(dragon).toBeDefined();
    moveDuelCard(session.state, troposphere!.uid, "hand", 0);
    moveDuelCard(session.state, wingedBeast!.uid, "monsterZone", 0);
    moveDuelCard(session.state, dragon!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(troposphereCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 154 && effect.sourceUid === troposphere!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 154,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-154",
        "lifePointValue": [Function],
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-material:target-not-race:512",
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "hand",
        ],
        "registryKey": "lua:72144675:lua-1-154",
        "sourceUid": "p0-deck-72144675-0",
        "statValue": [Function],
        "target": [Function],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLegalActions(restored.session, 0);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === troposphere!.uid && action.tributeUids.includes(dragon!.uid))).toBe(false);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === troposphere!.uid && action.tributeUids.includes(wingedBeast!.uid))).toBe(true);
    expect(() => tributeSummonDuelCard(restored.session.state, 0, troposphere!.uid, [dragon!.uid])).toThrow("cannot be released");
    expect(restored.session.state.cards.find((card) => card.uid === troposphere!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === dragon!.uid)).toMatchObject({ location: "monsterZone" });

    const allowed = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(allowed.restoreComplete, allowed.incompleteReasons.join("; ")).toBe(true);
    expect(allowed.missingRegistryKeys).toEqual([]);
    expect(allowed.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(allowed, 0);
    tributeSummonDuelCard(allowed.session.state, 0, troposphere!.uid, [wingedBeast!.uid]);
    expect(allowed.session.state.cards.find((card) => card.uid === troposphere!.uid)).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    expect(allowed.session.state.cards.find((card) => card.uid === wingedBeast!.uid)).toMatchObject({ location: "graveyard" });
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
