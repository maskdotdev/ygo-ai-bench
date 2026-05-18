import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const doubleSummonCode = "43422537";
const hasDoubleSummonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doubleSummonCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasDoubleSummonScript)("Lua real script Double Summon count limit", () => {
  it("restores official Double Summon's activation before granting the second Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    assertDoubleSummonScript(workspace);
    const cards: DuelCardData[] = [
      doubleSummonCard(),
      { code: "90000023", name: "Double Summon Restore First", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: "90000024", name: "Double Summon Restore Second", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 435, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doubleSummonCode, "90000023", "90000024"] }, 1: { main: [] } });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === doubleSummonCode);
    const first = session.state.cards.find((card) => card.code === "90000023");
    const second = session.state.cards.find((card) => card.code === "90000024");
    expect(spell).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doubleSummonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredActivation, 0));

    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === spell!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivation, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredActivation.session.state.effects.find((effect) => effect.code === 28 && effect.controller === 0)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 28,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-28",
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
        "registryKey": "lua:43422537:lua-2-28",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-43422537-0",
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
        "value": 2,
      }
    `);

    const firstSummon = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "normalSummon" && action.uid === first!.uid);
    expect(firstSummon).toBeDefined();
    const firstSummoned = applyLuaRestoreResponse(restoredActivation, firstSummon!);
    expect(firstSummoned.ok, firstSummoned.error).toBe(true);

    const restoredAfterFirstSummon = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expect(restoredAfterFirstSummon.restoreComplete, restoredAfterFirstSummon.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterFirstSummon.missingRegistryKeys).toEqual([]);
    expect(restoredAfterFirstSummon.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterFirstSummon, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterFirstSummon.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterFirstSummon, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredAfterFirstSummon, 0));

    const secondSummon = getLuaRestoreLegalActions(restoredAfterFirstSummon, 0).find((action) => action.type === "normalSummon" && action.uid === second!.uid);
    expect(secondSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterFirstSummon, 0), null, 2)).toBeDefined();
    const secondSummoned = applyLuaRestoreResponse(restoredAfterFirstSummon, secondSummon!);
    expect(secondSummoned.ok, secondSummoned.error).toBe(true);
    expect(restoredAfterFirstSummon.session.state.cards.find((card) => card.uid === second!.uid)).toMatchObject({ location: "monsterZone", summonType: "normal" });
    expect(restoredAfterFirstSummon.session.state.activityCounts[0].normalSummon).toBe(2);
  });

  it("lets official Double Summon grant a second Normal Summon legal action", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    assertDoubleSummonScript(workspace);
    const cards: DuelCardData[] = [
      doubleSummonCard(),
      { code: "90000021", name: "Double Summon First", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: "90000022", name: "Double Summon Second", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 434, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doubleSummonCode, "90000021", "90000022"] }, 1: { main: [] } });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === doubleSummonCode);
    const first = session.state.cards.find((card) => card.code === "90000021");
    const second = session.state.cards.find((card) => card.code === "90000022");
    expect(spell).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doubleSummonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === spell!.uid);
    expect(activate).toBeDefined();
    expect(applyResponse(session, activate!).ok).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 28 && effect.controller === 0)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 28,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-28",
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
        "registryKey": "lua:43422537:lua-2-28",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-43422537-0",
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
        "value": 2,
      }
    `);

    const firstSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === first!.uid);
    expect(firstSummon).toBeDefined();
    expect(applyResponse(session, firstSummon!).ok).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.code === 28 && effect.controller === 0)).toMatchInlineSnapshot(`
      {
        "code": 28,
        "controller": 0,
        "event": "continuous",
        "id": "lua-2-28",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
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
        "registryKey": "lua:43422537:lua-2-28",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-43422537-0",
        "targetRange": [
          1,
          0,
        ],
        "value": 2,
      }
    `);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const secondSummon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === second!.uid);
    expect(secondSummon).toBeDefined();
    const response = applyLuaRestoreResponse(restored, secondSummon!);
    expect(response.ok).toBe(true);
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    expect(restored.session.state.activityCounts[0].normalSummon).toBe(2);
  });
});

function doubleSummonCard(): DuelCardData {
  return { code: doubleSummonCode, name: "Double Summon", kind: "spell", typeFlags: typeSpell };
}

function assertDoubleSummonScript(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const script = workspace.readScript(`c${doubleSummonCode}.lua`);
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_SUMMON_COUNT_LIMIT)");
  expect(script).toContain("e1:SetValue(2)");
}
