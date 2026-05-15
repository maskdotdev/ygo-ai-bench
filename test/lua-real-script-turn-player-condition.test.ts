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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script turn player conditions", () => {
  it("restores standalone self and opponent turn-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tirasCode = "31386180";
    const springCode = "60600821";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tirasCode || card.code === springCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [tirasCode], main: [springCode] }, 1: { main: [] } });
    startDuel(session);

    const tiras = session.state.cards.find((card) => card.code === tirasCode);
    const spring = session.state.cards.find((card) => card.code === springCode);
    expect(tiras).toBeDefined();
    expect(spring).toBeDefined();
    moveDuelCard(session.state, tiras!.uid, "monsterZone", 0);
    moveDuelCard(session.state, spring!.uid, "spellTrapZone", 0).sequence = 5;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [tirasCode, springCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(
      session.state.effects.filter(
        (effect) =>
          (effect.luaConditionDescriptor === "condition:turn-player:self" &&
            effect.sourceUid === tiras!.uid &&
            effect.triggerEvent === "phaseEnd") ||
          (effect.luaConditionDescriptor === "condition:turn-player:opponent" &&
            effect.sourceUid === spring!.uid &&
            effect.triggerEvent === "phaseEnd"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 8388608,
          "code": 4608,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "description": 969613137,
          "event": "trigger",
          "id": "lua-5-4608",
          "luaConditionDescriptor": "condition:turn-player:opponent",
          "luaTypeFlags": 130,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:60600821:lua-5-4608",
          "sourceUid": "p0-deck-60600821-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
        {
          "canActivate": [Function],
          "code": 4608,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "description": 502178881,
          "event": "trigger",
          "id": "lua-9-4608",
          "luaConditionDescriptor": "condition:turn-player:self",
          "luaTypeFlags": 514,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": false,
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:31386180:lua-9-4608",
          "sourceUid": "p0-extraDeck-31386180-0",
          "target": [Function],
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTiras = restored.session.state.cards.find((card) => card.code === tirasCode);
    const restoredSpring = restored.session.state.cards.find((card) => card.code === springCode);
    const selfTurnEffect = restored.session.state.effects.find((effect) => effect.sourceUid === tiras!.uid && effect.luaConditionDescriptor === "condition:turn-player:self");
    const opponentTurnEffect = restored.session.state.effects.find((effect) => effect.sourceUid === spring!.uid && effect.luaConditionDescriptor === "condition:turn-player:opponent");
    expect(selfTurnEffect?.canActivate).toBeDefined();
    expect(opponentTurnEffect?.canActivate).toBeDefined();
    restored.session.state.turnPlayer = 0;
    expect(selfTurnEffect!.canActivate!(targetContext(restored.session.state, restoredTiras!))).toBe(true);
    expect(opponentTurnEffect!.canActivate!(targetContext(restored.session.state, restoredSpring!))).toBe(false);
    restored.session.state.turnPlayer = 1;
    expect(selfTurnEffect!.canActivate!(targetContext(restored.session.state, restoredTiras!))).toBe(false);
    expect(opponentTurnEffect!.canActivate!(targetContext(restored.session.state, restoredSpring!))).toBe(true);
  });
});
