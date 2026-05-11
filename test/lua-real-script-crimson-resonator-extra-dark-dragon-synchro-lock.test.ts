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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Crimson Resonator Extra DARK Dragon Synchro lock", () => {
  it("restores its cost-created Extra Deck-only DARK Dragon Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crimsonCode = "34761841";
    const allowedCode = "900000311";
    const lightDragonSynchroCode = "900000312";
    const darkFiendSynchroCode = "900000313";
    const darkDragonFusionCode = "900000314";
    const handLightCode = "900000315";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crimsonCode),
      { code: allowedCode, name: "Crimson DARK Dragon Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: lightDragonSynchroCode, name: "Crimson LIGHT Dragon Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: darkFiendSynchroCode, name: "Crimson DARK Fiend Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: darkDragonFusionCode, name: "Crimson DARK Dragon Fusion Probe", kind: "monster", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handLightCode, name: "Crimson Hand LIGHT Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 347, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crimsonCode, handLightCode], extra: [allowedCode, lightDragonSynchroCode, darkFiendSynchroCode, darkDragonFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const crimson = session.state.cards.find((card) => card.code === crimsonCode);
    const handLight = session.state.cards.find((card) => card.code === handLightCode);
    expect(crimson).toBeDefined();
    expect(handLight).toBeDefined();
    moveDuelCard(session.state, crimson!.uid, "hand", 0);
    moveDuelCard(session.state, handLight!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crimsonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const cost = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${crimsonCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${crimsonCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "crimson-resonator-official-spcost.lua",
    );
    expect(cost.ok, cost.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local allowed=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${allowedCode}),0,LOCATION_EXTRA,0,nil)
      local light_dragon=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightDragonSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fiend=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFiendSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_dragon_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkDragonFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handLightCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("crimson light dragon synchro special " .. Duel.SpecialSummon(light_dragon,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark fiend synchro special " .. Duel.SpecialSummon(dark_fiend,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark dragon fusion special " .. Duel.SpecialSummon(dark_dragon_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson dark dragon synchro special " .. Duel.SpecialSummon(allowed,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("crimson hand light special " .. Duel.SpecialSummon(hand_light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "crimson-resonator-extra-dark-dragon-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "crimson light dragon synchro special 0",
        "crimson dark fiend synchro special 0",
        "crimson dark dragon fusion special 0",
        "crimson dark dragon synchro special 1",
        "crimson hand light special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
