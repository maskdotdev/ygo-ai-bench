import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const kochiCode = "41902352";
const spiritMessageCode = "30170981";
const hasKochiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kochiCode}.lua`));
const hasSpiritMessageScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiritMessageCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasKochiScript || !hasSpiritMessageScript)("Lua real script Special Summon cost gates", () => {
  it("restores official EFFECT_SPSUMMON_COST summon-type inequality predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${kochiCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_COST)");
    expect(script).toContain("return sumtype~=SUMMON_TYPE_SPECIAL+182");
    const cards: DuelCardData[] = [
      { code: kochiCode, name: "Blackwing - Kochi the Daybreak", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 700, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 419, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kochiCode] }, 1: { main: [] } });
    startDuel(session);

    const kochi = session.state.cards.find((card) => card.code === kochiCode);
    expect(kochi).toBeDefined();
    moveDuelCard(session.state, kochi!.uid, "hand", 0);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kochiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 92 && effect.sourceUid === kochi!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 92,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-92",
        "luaCostDescriptor": "cost:special-summon-type-not:1073742006",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "hand",
        ],
        "registryKey": "lua:41902352:lua-2-92",
        "sourceUid": "p0-deck-41902352-0",
        "target": [Function],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 92 && effect.sourceUid === kochi!.uid)).toMatchInlineSnapshot(`
      {
        "code": 92,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-92",
        "luaCostDescriptor": "cost:special-summon-type-not:1073742006",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "hand",
        ],
        "registryKey": "lua:41902352:lua-2-92",
        "sourceUid": "p0-deck-41902352-0",
      }
    `);
    const restoredCost = restored.session.state.effects.find((effect) => effect.sourceUid === kochi!.uid && effect.code === 92)?.cost;
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 182, checkOnly: true } as never)).toBe(false);
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 181, checkOnly: true } as never)).toBe(true);
  });

  it("restores official EFFECT_SPSUMMON_COST summon-type equality predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${spiritMessageCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_COST)");
    expect(script).toContain("return sumtype==SUMMON_TYPE_SPECIAL+181");
    const cards: DuelCardData[] = [
      { code: spiritMessageCode, name: 'Spirit Message "L" Cost Probe', kind: "monster", typeFlags: typeMonster, level: 1, attack: 0, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiritMessageCode] }, 1: { main: [] } });
    startDuel(session);

    const spiritMessage = session.state.cards.find((card) => card.code === spiritMessageCode);
    expect(spiritMessage).toBeDefined();
    moveDuelCard(session.state, spiritMessage!.uid, "hand", 0);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiritMessageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 92 && effect.sourceUid === spiritMessage!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 92,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-92",
        "luaCostDescriptor": "cost:special-summon-type-is:1073742005",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "hand",
        ],
        "registryKey": "lua:30170981:lua-2-92",
        "sourceUid": "p0-deck-30170981-0",
        "target": [Function],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 92 && effect.sourceUid === spiritMessage!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 92,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-92",
        "luaCostDescriptor": "cost:special-summon-type-is:1073742005",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "hand",
        ],
        "registryKey": "lua:30170981:lua-2-92",
        "sourceUid": "p0-deck-30170981-0",
        "target": [Function],
      }
    `);
    const restoredCost = restored.session.state.effects.find((effect) => effect.sourceUid === spiritMessage!.uid && effect.code === 92)?.cost;
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 181, checkOnly: true } as never)).toBe(true);
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 182, checkOnly: true } as never)).toBe(false);
  });
});
