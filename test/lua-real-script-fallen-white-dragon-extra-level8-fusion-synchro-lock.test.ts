import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fallen of the White Dragon Extra Level 8 Fusion/Synchro lock", () => {
  it("restores its Extra Deck-only Level 8 Fusion/Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fallenCode = "73819701";
    const level8FusionCode = "900000391";
    const level7FusionCode = "900000392";
    const level8SynchroCode = "900000393";
    const level8XyzCode = "900000394";
    const deckCode = "900000395";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fallenCode),
      { code: level8FusionCode, name: "Fallen White Dragon Level 8 Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: level7FusionCode, name: "Fallen White Dragon Level 7 Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 7, attack: 1000, defense: 1000 },
      { code: level8SynchroCode, name: "Fallen White Dragon Level 8 Synchro Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: level8XyzCode, name: "Fallen White Dragon Level 8 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Fallen White Dragon Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 738, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fallenCode, deckCode], extra: [level8FusionCode, level7FusionCode, level8SynchroCode, level8XyzCode] }, 1: { main: [] } });
    startDuel(session);
    const fallen = session.state.cards.find((card) => card.code === fallenCode);
    expect(fallen).toBeDefined();
    moveDuelCard(session.state, fallen!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fallenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fallenCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${fallenCode}.selfspop(e,0,nil,0,0,nil,0,0)
      `,
      "fallen-white-dragon-official-selfspop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-level-extra:8256:8",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local level8_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level8FusionCode}),0,LOCATION_EXTRA,0,nil)
      local level7_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level7FusionCode}),0,LOCATION_EXTRA,0,nil)
      local level8_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level8SynchroCode}),0,LOCATION_EXTRA,0,nil)
      local level8_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level8XyzCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("fallen white level7 fusion special " .. Duel.SpecialSummon(level7_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fallen white level8 xyz special " .. Duel.SpecialSummon(level8_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fallen white level8 fusion special " .. Duel.SpecialSummon(level8_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fallen white level8 synchro special " .. Duel.SpecialSummon(level8_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fallen white deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "fallen-white-dragon-extra-level8-fusion-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fallen white level7 fusion special 0",
        "fallen white level8 xyz special 0",
        "fallen white level8 fusion special 1",
        "fallen white level8 synchro special 1",
        "fallen white deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
