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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script turn player main phase conditions", () => {
  it("restores self and opponent turn-player main phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maliciousmagnetCode = "62899696";
    const shiningStarCode = "75874514";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maliciousmagnetCode || card.code === shiningStarCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maliciousmagnetCode, shiningStarCode] }, 1: { main: [] } });
    startDuel(session);

    const maliciousmagnet = session.state.cards.find((card) => card.code === maliciousmagnetCode);
    const shiningStar = session.state.cards.find((card) => card.code === shiningStarCode);
    expect(maliciousmagnet).toBeDefined();
    expect(shiningStar).toBeDefined();
    moveDuelCard(session.state, maliciousmagnet!.uid, "monsterZone", 0);
    moveDuelCard(session.state, shiningStar!.uid, "hand", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [maliciousmagnetCode, shiningStarCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(
      session.state.effects.filter(
        (effect) =>
          (effect.luaConditionDescriptor === "condition:turn-player:self-main-phase" &&
            effect.sourceUid === maliciousmagnet!.uid) ||
          (effect.luaConditionDescriptor === "condition:turn-player:opponent-main-phase" &&
            effect.sourceUid === shiningStar!.uid),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 512,
          "code": 1100,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 62899696,
          "description": 1006395137,
          "event": "trigger",
          "id": "lua-2-1100",
          "luaConditionDescriptor": "condition:turn-player:self-main-phase",
          "luaTypeFlags": 129,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65552,
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
          "registryKey": "lua:62899696:lua-2-1100",
          "sourceUid": "p0-deck-62899696-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1100,
          "triggerEvent": "normalSummoned",
          "triggerSourceOnly": true,
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "category": 512,
          "code": 1102,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 62899696,
          "description": 1006395137,
          "event": "trigger",
          "id": "lua-3-1102",
          "luaConditionDescriptor": "condition:turn-player:self-main-phase",
          "luaTypeFlags": 129,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65552,
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
          "registryKey": "lua:62899696:lua-3-1102",
          "sourceUid": "p0-deck-62899696-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1102,
          "triggerEvent": "specialSummoned",
          "triggerSourceOnly": true,
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "category": 512,
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 75874514,
          "description": 1213992224,
          "event": "quick",
          "hintTiming": [
            0,
            452,
          ],
          "id": "lua-4-1002",
          "luaConditionDescriptor": "condition:turn-player:opponent-main-phase",
          "luaTypeFlags": 256,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 16,
          "range": [
            "hand",
          ],
          "registryKey": "lua:75874514:lua-4-1002",
          "sourceUid": "p0-deck-75874514-1",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredMaliciousmagnet = restored.session.state.cards.find((card) => card.code === maliciousmagnetCode);
    const restoredShiningStar = restored.session.state.cards.find((card) => card.code === shiningStarCode);
    const selfMainPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === maliciousmagnet!.uid && effect.luaConditionDescriptor === "condition:turn-player:self-main-phase");
    const opponentMainPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === shiningStar!.uid && effect.luaConditionDescriptor === "condition:turn-player:opponent-main-phase");
    expect(selfMainPhaseEffect?.canActivate).toBeDefined();
    expect(opponentMainPhaseEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "main1";
    restored.session.state.turnPlayer = 0;
    expect(selfMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredMaliciousmagnet!))).toBe(true);
    expect(opponentMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredShiningStar!))).toBe(false);
    restored.session.state.turnPlayer = 1;
    expect(selfMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredMaliciousmagnet!))).toBe(false);
    expect(opponentMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredShiningStar!))).toBe(true);
    restored.session.state.phase = "main2";
    expect(opponentMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredShiningStar!))).toBe(true);
    restored.session.state.phase = "battle";
    expect(opponentMainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredShiningStar!))).toBe(false);
  });
});
