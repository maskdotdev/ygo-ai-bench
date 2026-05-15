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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Core of Chaos Extra Light/Dark Synchro lock", () => {
  it("restores its Extra Deck-only Light or Dark Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coreOfChaosCode = "3806388";
    const lightSynchroCode = "900000471";
    const darkSynchroCode = "900000472";
    const earthSynchroCode = "900000473";
    const lightFusionCode = "900000474";
    const deckCode = "900000475";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coreOfChaosCode),
      { code: lightSynchroCode, name: "Core of Chaos Light Synchro Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
      { code: darkSynchroCode, name: "Core of Chaos Dark Synchro Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: earthSynchroCode, name: "Core of Chaos Earth Synchro Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
      { code: lightFusionCode, name: "Core of Chaos Light Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Core of Chaos Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 380, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coreOfChaosCode, deckCode], extra: [lightSynchroCode, darkSynchroCode, earthSynchroCode, lightFusionCode] }, 1: { main: [] } });
    startDuel(session);
    const coreOfChaos = session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(coreOfChaos).toBeDefined();
    moveDuelCard(session.state, coreOfChaos!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coreOfChaosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${coreOfChaosCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${coreOfChaosCode}.hspop(e,0,nil,0,0,nil,0,0)
      `,
      "core-of-chaos-official-hspop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-attribute-extra:8192:48",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local light_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local earth_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${earthSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightFusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("core earth synchro special " .. Duel.SpecialSummon(earth_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("core light fusion special " .. Duel.SpecialSummon(light_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("core light synchro special " .. Duel.SpecialSummon(light_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("core dark synchro special " .. Duel.SpecialSummon(dark_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("core deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "core-of-chaos-extra-light-dark-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "core earth synchro special 0",
        "core light fusion special 0",
        "core light synchro special 1",
        "core dark synchro special 1",
        "core deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
