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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Windwitch Ice Bell Extra Level 5 Wind lock", () => {
  it("restores its Extra Deck-only Level 5 or higher Wind special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const iceBellCode = "43722862";
    const level5WindCode = "900000441";
    const level6WindCode = "900000442";
    const level4WindCode = "900000443";
    const level5EarthCode = "900000444";
    const deckCode = "900000445";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === iceBellCode),
      { code: level5WindCode, name: "Ice Bell Level 5 Wind Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x8, level: 5, attack: 1000, defense: 1000 },
      { code: level6WindCode, name: "Ice Bell Level 6 Wind Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x8, level: 6, attack: 1000, defense: 1000 },
      { code: level4WindCode, name: "Ice Bell Level 4 Wind Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x8, level: 4, attack: 1000, defense: 1000 },
      { code: level5EarthCode, name: "Ice Bell Level 5 Earth Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x1, level: 5, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Ice Bell Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 437, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [iceBellCode, deckCode], extra: [level5WindCode, level6WindCode, level4WindCode, level5EarthCode] }, 1: { main: [] } });
    startDuel(session);
    const iceBell = session.state.cards.find((card) => card.code === iceBellCode);
    expect(iceBell).toBeDefined();
    moveDuelCard(session.state, iceBell!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(iceBellCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const payCost = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${iceBellCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${iceBellCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "windwitch-ice-bell-official-spcost.lua",
    );
    expect(payCost.ok, payCost.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-level-above-attribute-extra:5:8",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local level5_wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5WindCode}),0,LOCATION_EXTRA,0,nil)
      local level6_wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level6WindCode}),0,LOCATION_EXTRA,0,nil)
      local level4_wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level4WindCode}),0,LOCATION_EXTRA,0,nil)
      local level5_earth=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level5EarthCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("ice bell level4 wind special " .. Duel.SpecialSummon(level4_wind,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ice bell level5 earth special " .. Duel.SpecialSummon(level5_earth,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ice bell level5 wind special " .. Duel.SpecialSummon(level5_wind,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ice bell level6 wind special " .. Duel.SpecialSummon(level6_wind,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("ice bell deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "windwitch-ice-bell-extra-level5-wind-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "ice bell level4 wind special 0",
        "ice bell level5 earth special 0",
        "ice bell level5 wind special 1",
        "ice bell level6 wind special 1",
        "ice bell deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
