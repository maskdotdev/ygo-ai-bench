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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script main-or-battle phase conditions", () => {
  it("restores standalone main phase or battle phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const carnovorusCode = "34149150";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === carnovorusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [carnovorusCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const carnovorus = session.state.cards.find((card) => card.code === carnovorusCode);
    expect(carnovorus).toBeDefined();
    moveDuelCard(session.state, carnovorus!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(carnovorusCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === "condition:main-or-battle-phase" && effect.sourceUid === carnovorus!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 512,
        "code": 1002,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "countLimitCode": 34149150,
        "description": 546386400,
        "event": "quick",
        "hintTiming": [
          0,
          476,
        ],
        "id": "lua-3-1002",
        "luaConditionDescriptor": "condition:main-or-battle-phase",
        "luaTypeFlags": 256,
        "oncePerTurn": true,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:34149150:lua-3-1002",
        "sourceUid": "p0-extraDeck-34149150-0",
        "target": [Function],
        "targetCardPredicate": [Function],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredCarnovorus = restored.session.state.cards.find((card) => card.code === carnovorusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === carnovorus!.uid && candidate.luaConditionDescriptor === "condition:main-or-battle-phase");
    expect(effect?.canActivate).toBeDefined();
    restored.session.state.phase = "main1";
    expect(effect!.canActivate!(targetContext(restored.session.state, restoredCarnovorus!))).toBe(true);
    restored.session.state.phase = "main2";
    expect(effect!.canActivate!(targetContext(restored.session.state, restoredCarnovorus!))).toBe(true);
    restored.session.state.phase = "battle";
    expect(effect!.canActivate!(targetContext(restored.session.state, restoredCarnovorus!))).toBe(true);
    restored.session.state.phase = "standby";
    expect(effect!.canActivate!(targetContext(restored.session.state, restoredCarnovorus!))).toBe(false);
  });
});
