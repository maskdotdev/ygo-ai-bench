import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Doggy Diver Xyz material lock", () => {
  it("restores official target-filtered EFFECT_CANNOT_BE_XYZ_MATERIAL", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const doggyCode = "1003028";
    const level4Code = "900000245";
    const fiendXyzCode = "900000246";
    const warriorXyzCode = "900000247";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === doggyCode),
      { code: level4Code, name: "Level 4 Xyz Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: fiendXyzCode, name: "Fiend Xyz Fixture", kind: "extra", typeFlags: 0x800001, race: 0x8, level: 4, attack: 2100, defense: 1600, xyzMaterialCount: 2 },
      { code: warriorXyzCode, name: "Warrior Xyz Fixture", kind: "extra", typeFlags: 0x800001, race: 0x1, level: 4, attack: 2100, defense: 1600, xyzMaterialCount: 2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 100, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doggyCode, level4Code], extra: [fiendXyzCode, warriorXyzCode] }, 1: { main: [] } });
    startDuel(session);

    const doggy = session.state.cards.find((card) => card.code === doggyCode);
    const level4 = session.state.cards.find((card) => card.code === level4Code);
    const fiendXyz = session.state.cards.find((card) => card.code === fiendXyzCode);
    const warriorXyz = session.state.cards.find((card) => card.code === warriorXyzCode);
    expect(doggy).toBeDefined();
    expect(level4).toBeDefined();
    expect(fiendXyz).toBeDefined();
    expect(warriorXyz).toBeDefined();
    moveDuelCard(session.state, doggy!.uid, "monsterZone", 0);
    moveDuelCard(session.state, level4!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doggyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 238 && effect.sourceUid === doggy!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 238,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-238",
        "lifePointValue": [Function],
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-material:target-not-race:1",
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 263168,
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
        "registryKey": "lua:1003028:lua-2-238",
        "sourceUid": "p0-deck-1003028-0",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.code === 238 && effect.sourceUid === doggy!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 238,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-238",
        "lifePointValue": [Function],
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-material:target-not-race:1",
        "oncePerTurn": false,
        "operation": [Function],
        "property": 263168,
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
        "registryKey": "lua:1003028:lua-2-238",
        "sourceUid": "p0-deck-1003028-0",
        "statValue": [Function],
        "target": [Function],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    const legalActions = getLegalActions(restored.session, 0);
    expect(legalActions.some((action) => action.type === "xyzSummon" && action.uid === fiendXyz!.uid)).toBe(false);
    expect(() => xyzSummonDuelCard(restored.session.state, 0, fiendXyz!.uid, [doggy!.uid, level4!.uid])).toThrow("cannot be used as Xyz material");
    expect(restored.session.state.cards.find((card) => card.uid === fiendXyz!.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === doggy!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === level4!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
