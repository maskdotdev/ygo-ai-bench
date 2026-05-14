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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Crimson Resonator Extra Dark Dragon Synchro lock", () => {
  it("restores its Extra Deck-only Dark Dragon Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crimsonResonatorCode = "34761841";
    const darkDragonSynchroCode = "900000491";
    const lightDragonSynchroCode = "900000492";
    const darkFiendSynchroCode = "900000493";
    const darkDragonXyzCode = "900000494";
    const deckCode = "900000495";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crimsonResonatorCode),
      { code: darkDragonSynchroCode, name: "Crimson Dark Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: lightDragonSynchroCode, name: "Crimson Light Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: darkFiendSynchroCode, name: "Crimson Dark Fiend Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: darkDragonXyzCode, name: "Crimson Dark Dragon Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Crimson Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 347, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crimsonResonatorCode, deckCode], extra: [darkDragonSynchroCode, lightDragonSynchroCode, darkFiendSynchroCode, darkDragonXyzCode] }, 1: { main: [] } });
    startDuel(session);
    const crimsonResonator = session.state.cards.find((card) => card.code === crimsonResonatorCode);
    expect(crimsonResonator).toBeDefined();
    moveDuelCard(session.state, crimsonResonator!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crimsonResonatorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const payCost = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${crimsonResonatorCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${crimsonResonatorCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "crimson-resonator-official-spcost.lua",
    );
    expect(payCost.ok, payCost.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-attribute-race-extra:8192:32:8192",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local dark_dragon_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_dragon_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fiend_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFiendSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_dragon_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonXyzCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("crimson light dragon synchro special " .. Duel.SpecialSummon(light_dragon_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark fiend synchro special " .. Duel.SpecialSummon(dark_fiend_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark dragon xyz special " .. Duel.SpecialSummon(dark_dragon_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark dragon synchro special " .. Duel.SpecialSummon(dark_dragon_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "crimson-resonator-extra-dark-dragon-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "crimson light dragon synchro special 0",
        "crimson dark fiend synchro special 0",
        "crimson dark dragon xyz special 0",
        "crimson dark dragon synchro special 1",
        "crimson deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
