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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script named phase conditions", () => {
  it("restores standalone named main, main2, and standby phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fabledCode = "21281085";
    const strikeFighterCode = "66122213";
    const clownCrewCode = "6547248";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [fabledCode, strikeFighterCode, clownCrewCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [fabledCode, strikeFighterCode], main: [clownCrewCode] }, 1: { main: [] } });
    startDuel(session);

    const fabled = session.state.cards.find((card) => card.code === fabledCode);
    const strikeFighter = session.state.cards.find((card) => card.code === strikeFighterCode);
    const clownCrew = session.state.cards.find((card) => card.code === clownCrewCode);
    expect(fabled).toBeDefined();
    expect(strikeFighter).toBeDefined();
    expect(clownCrew).toBeDefined();
    moveDuelCard(session.state, fabled!.uid, "monsterZone", 0);
    moveDuelCard(session.state, strikeFighter!.uid, "monsterZone", 0).sequence = 1;
    moveDuelCard(session.state, clownCrew!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [fabledCode, strikeFighterCode, clownCrewCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.filter((effect) => [fabled!.uid, strikeFighter!.uid, clownCrew!.uid].includes(effect.sourceUid))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "event": "ignition",
          "id": "lua-1-1002",
          "luaTypeFlags": 16,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:6547248:lua-1-1002",
          "sourceUid": "p0-deck-6547248-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "category": 65552,
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 26817527808,
          "description": 104755968,
          "event": "quick",
          "hintTiming": [
            2,
          ],
          "id": "lua-2-1002",
          "luaConditionDescriptor": "condition:phase:2",
          "luaTypeFlags": 256,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:6547248:lua-2-1002",
          "sourceUid": "p0-deck-6547248-0",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
        {
          "canActivate": [Function],
          "category": 1,
          "code": 1100,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 26817527824,
          "description": 104755969,
          "event": "trigger",
          "id": "lua-3-1100",
          "luaTypeFlags": 130,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65552,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:6547248:lua-3-1100",
          "sourceUid": "p0-deck-6547248-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1100,
          "triggerEvent": "normalSummoned",
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "code": 1014,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 26817527840,
          "description": 104755970,
          "event": "trigger",
          "id": "lua-4-1014",
          "luaTypeFlags": 129,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65536,
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
          "registryKey": "lua:6547248:lua-4-1014",
          "sourceUid": "p0-deck-6547248-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1014,
          "triggerEvent": "sentToGraveyard",
          "triggerSourceOnly": true,
          "triggerTiming": "if",
        },
        {
          "canActivate": [Function],
          "code": 31,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-31",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 263168,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:21281085:lua-5-31",
          "sourceUid": "p0-extraDeck-21281085-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "category": 8194,
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "description": 340497360,
          "event": "quick",
          "hintTiming": [
            0,
            452,
          ],
          "id": "lua-6-1002",
          "luaConditionDescriptor": "condition:main-phase",
          "luaTypeFlags": 256,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:21281085:lua-6-1002",
          "sourceUid": "p0-extraDeck-21281085-0",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
        {
          "canActivate": [Function],
          "category": 2147483656,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 21281085,
          "description": 340497361,
          "event": "ignition",
          "id": "lua-7",
          "luaTypeFlags": 64,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 16,
          "range": [
            "graveyard",
          ],
          "registryKey": "lua:21281085:lua-7",
          "sourceUid": "p0-extraDeck-21281085-0",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 31,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-8-31",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 263168,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:66122213:lua-8-31",
          "sourceUid": "p0-extraDeck-66122213-1",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "category": 524289,
          "code": 1002,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 270836584448,
          "description": 1057955408,
          "event": "quick",
          "hintTiming": [
            0,
            452,
          ],
          "id": "lua-9-1002",
          "luaConditionDescriptor": "condition:phase:256",
          "luaTypeFlags": 256,
          "oncePerTurn": true,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:66122213:lua-9-1002",
          "sourceUid": "p0-extraDeck-66122213-1",
          "target": [Function],
          "targetCardPredicate": [Function],
        },
        {
          "canActivate": [Function],
          "category": 512,
          "code": 1029,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 270836584464,
          "description": 1057955409,
          "event": "trigger",
          "id": "lua-10-1029",
          "luaConditionDescriptor": "condition:source-reason:96",
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
          "registryKey": "lua:66122213:lua-10-1029",
          "sourceUid": "p0-extraDeck-66122213-1",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1029,
          "triggerEvent": "destroyed",
          "triggerSourceOnly": true,
          "triggerTiming": "if",
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
    const restoredFabled = restored.session.state.cards.find((card) => card.code === fabledCode);
    const restoredStrikeFighter = restored.session.state.cards.find((card) => card.code === strikeFighterCode);
    const restoredClownCrew = restored.session.state.cards.find((card) => card.code === clownCrewCode);
    const mainPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === fabled!.uid && effect.luaConditionDescriptor === "condition:main-phase");
    const main2Effect = restored.session.state.effects.find((effect) => effect.sourceUid === strikeFighter!.uid && effect.luaConditionDescriptor === "condition:phase:256");
    const standbyEffect = restored.session.state.effects.find((effect) => effect.sourceUid === clownCrew!.uid && effect.luaConditionDescriptor === "condition:phase:2");
    expect(mainPhaseEffect?.canActivate).toBeDefined();
    expect(main2Effect?.canActivate).toBeDefined();
    expect(standbyEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "main1";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(true);
    expect(main2Effect!.canActivate!(targetContext(restored.session.state, restoredStrikeFighter!))).toBe(false);
    restored.session.state.phase = "main2";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(true);
    expect(main2Effect!.canActivate!(targetContext(restored.session.state, restoredStrikeFighter!))).toBe(true);
    restored.session.state.phase = "standby";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(false);
    expect(standbyEffect!.canActivate!(targetContext(restored.session.state, restoredClownCrew!))).toBe(true);
  });
});
