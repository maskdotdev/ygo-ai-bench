import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  fusionSummonDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mysterion fusion material lock", () => {
  it("restores official EFFECT_CANNOT_BE_FUSION_MATERIAL and removes Fusion Summon actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mysterionCode = "13735899";
    const freeMaterialCode = "900000240";
    const targetFusionCode = "900000241";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mysterionCode),
      { code: freeMaterialCode, name: "Free Fusion Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      {
        code: targetFusionCode,
        name: "Mysterion Material Check Fusion",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 2500,
        defense: 2000,
        fusionMaterials: [mysterionCode, freeMaterialCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 137, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [freeMaterialCode], extra: [mysterionCode, targetFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const mysterion = session.state.cards.find((card) => card.code === mysterionCode);
    const freeMaterial = session.state.cards.find((card) => card.code === freeMaterialCode);
    const targetFusion = session.state.cards.find((card) => card.code === targetFusionCode);
    expect(mysterion).toBeDefined();
    expect(freeMaterial).toBeDefined();
    expect(targetFusion).toBeDefined();
    moveDuelCard(session.state, mysterion!.uid, "monsterZone", 0);
    mysterion!.position = "faceUpAttack";
    mysterion!.faceUp = true;
    moveDuelCard(session.state, freeMaterial!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mysterionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 235 && effect.sourceUid === mysterion!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 235,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-235",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 263168,
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:13735899:lua-2-235",
        "sourceUid": "p0-extraDeck-13735899-0",
        "target": [Function],
        "value": 1,
      }
    `);
    expect(getLegalActions(session, 0).some((action) => action.type === "fusionSummon" && action.uid === targetFusion!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 235 && effect.sourceUid === mysterion!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 235,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-235",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "property": 263168,
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:13735899:lua-2-235",
        "sourceUid": "p0-extraDeck-13735899-0",
        "target": [Function],
        "value": 1,
      }
    `);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "fusionSummon" && action.uid === targetFusion!.uid)).toBe(false);
    expect(() => fusionSummonDuelCard(restored.session.state, 0, targetFusion!.uid, [mysterion!.uid, freeMaterial!.uid])).toThrow("cannot be used as fusion material");
    expect(restored.session.state.cards.find((card) => card.uid === targetFusion!.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === mysterion!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === freeMaterial!.uid)).toMatchObject({ location: "hand" });
  });
});
