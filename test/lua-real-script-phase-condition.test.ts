import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script phase-only conditions", () => {
  it("restores standalone battle phase and exact phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const damageJugglerCode = "68819554";
    const junkSleepCode = "56294501";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === damageJugglerCode || card.code === junkSleepCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [damageJugglerCode, junkSleepCode] }, 1: { main: [] } });
    startDuel(session);

    const damageJuggler = session.state.cards.find((card) => card.code === damageJugglerCode);
    const junkSleep = session.state.cards.find((card) => card.code === junkSleepCode);
    expect(damageJuggler).toBeDefined();
    expect(junkSleep).toBeDefined();
    moveDuelCard(session.state, damageJuggler!.uid, "hand", 0);
    moveDuelCard(session.state, junkSleep!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [damageJugglerCode, junkSleepCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => [damageJuggler!.uid, junkSleep!.uid].includes(effect.sourceUid))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 268435457,
          "code": 1027,
          "controller": 0,
          "cost": [Function],
          "description": 1101112864,
          "event": "quick",
          "id": "lua-1-1027",
          "luaTypeFlags": 256,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 49152,
          "range": [
            "hand",
          ],
          "registryKey": "lua:68819554:lua-1-1027",
          "sourceUid": "p0-deck-68819554-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1027,
          "triggerEvent": "chaining",
          "triggerTiming": "when",
        },
        {
          "canActivate": [Function],
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "description": 1101112865,
          "event": "quick",
          "id": "lua-2-1002",
          "luaConditionDescriptor": "condition:battle-phase",
          "luaTypeFlags": 256,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "hand",
          ],
          "registryKey": "lua:68819554:lua-2-1002",
          "sourceUid": "p0-deck-68819554-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "category": 131080,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 68819554,
          "event": "ignition",
          "id": "lua-3",
          "luaTypeFlags": 64,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "graveyard",
          ],
          "registryKey": "lua:68819554:lua-3",
          "sourceUid": "p0-deck-68819554-0",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "event": "quick",
          "id": "lua-4-1002",
          "luaTypeFlags": 16,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:56294501:lua-4-1002",
          "sourceUid": "p0-deck-56294501-1",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "category": 4096,
          "code": 1100,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 56294501,
          "description": 900712016,
          "event": "trigger",
          "id": "lua-5-1100",
          "luaTypeFlags": 130,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65536,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:56294501:lua-5-1100",
          "sourceUid": "p0-deck-56294501-1",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1100,
          "triggerEvent": "normalSummoned",
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "category": 4096,
          "code": 1102,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 56294501,
          "description": 900712016,
          "event": "trigger",
          "id": "lua-6-1102",
          "luaTypeFlags": 130,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65536,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:56294501:lua-6-1102",
          "sourceUid": "p0-deck-56294501-1",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1102,
          "triggerEvent": "specialSummoned",
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "category": 4294971392,
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 230582276112,
          "description": 900712017,
          "event": "quick",
          "hintTiming": [
            32,
          ],
          "id": "lua-7-1002",
          "luaConditionDescriptor": "condition:phase:512",
          "luaTypeFlags": 256,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:56294501:lua-7-1002",
          "sourceUid": "p0-deck-56294501-1",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredDamageJuggler = restored.session.state.cards.find((card) => card.code === damageJugglerCode);
    const restoredJunkSleep = restored.session.state.cards.find((card) => card.code === junkSleepCode);
    const battlePhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === damageJuggler!.uid && effect.luaConditionDescriptor === "condition:battle-phase");
    const endPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === junkSleep!.uid && effect.luaConditionDescriptor === "condition:phase:512");
    expect(battlePhaseEffect?.canActivate).toBeDefined();
    expect(endPhaseEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "battle";
    expect(battlePhaseEffect!.canActivate!(targetContext(restored.session.state, restoredDamageJuggler!))).toBe(true);
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(false);
    restored.session.state.phase = "end";
    expect(battlePhaseEffect!.canActivate!(targetContext(restored.session.state, restoredDamageJuggler!))).toBe(false);
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(true);
    restored.session.state.phase = "main1";
    expect(endPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredJunkSleep!))).toBe(false);
  });
});
