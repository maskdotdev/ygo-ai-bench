import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Schwarzschild Extra Dragon Xyz lock", () => {
  it("restores its Extra Deck-only Dragon Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const schwarzschildCode = "18294799";
    const dragonXyzCode = "900000481";
    const machineXyzCode = "900000482";
    const dragonSynchroCode = "900000483";
    const deckCode = "900000484";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === schwarzschildCode),
      { code: dragonXyzCode, name: "Schwarzschild Dragon Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: machineXyzCode, name: "Schwarzschild Machine Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x20, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: dragonSynchroCode, name: "Schwarzschild Dragon Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Schwarzschild Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x20, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 182, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [schwarzschildCode, deckCode], extra: [dragonXyzCode, machineXyzCode, dragonSynchroCode] }, 1: { main: [] } });
    startDuel(session);
    const schwarzschild = session.state.cards.find((card) => card.code === schwarzschildCode);
    expect(schwarzschild).toBeDefined();
    moveDuelCard(session.state, schwarzschild!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(schwarzschildCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const payCost = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${schwarzschildCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${schwarzschildCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "schwarzschild-official-spcost.lua",
    );
    expect(payCost.ok, payCost.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-race-extra:8388608:8192",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local dragon_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonXyzCode}),0,LOCATION_EXTRA,0,nil)
      local machine_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineXyzCode}),0,LOCATION_EXTRA,0,nil)
      local dragon_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("schwarzschild machine xyz special " .. Duel.SpecialSummon(machine_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("schwarzschild dragon synchro special " .. Duel.SpecialSummon(dragon_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("schwarzschild dragon xyz special " .. Duel.SpecialSummon(dragon_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("schwarzschild deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "schwarzschild-extra-dragon-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "schwarzschild machine xyz special 0",
        "schwarzschild dragon synchro special 0",
        "schwarzschild dragon xyz special 1",
        "schwarzschild deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
