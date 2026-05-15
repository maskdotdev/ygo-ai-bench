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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cation Extra LIGHT Xyz lock", () => {
  it("restores its Location-first Attribute-then-Type Extra Deck-only LIGHT Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cationCode = "21291696";
    const lightXyzCode = "900000326";
    const darkXyzCode = "900000327";
    const lightFusionCode = "900000328";
    const deckDarkCode = "900000329";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cationCode),
      { code: lightXyzCode, name: "Cation LIGHT Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: darkXyzCode, name: "Cation DARK Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: lightFusionCode, name: "Cation LIGHT Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: deckDarkCode, name: "Cation Deck DARK Probe", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 212, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cationCode, deckDarkCode], extra: [lightXyzCode, darkXyzCode, lightFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const cation = session.state.cards.find((card) => card.code === cationCode);
    expect(cation).toBeDefined();
    moveDuelCard(session.state, cation!.uid, "monsterZone", 0);
    cation!.position = "faceUpAttack";
    cation!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cationCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${cationCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${cationCode}.thop(e,0,nil,0,0,nil,0,0)
      `,
      "cation-official-thop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-attribute-extra:8388608:16",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local light_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightXyzCode}),0,LOCATION_EXTRA,0,nil)
      local dark_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkXyzCode}),0,LOCATION_EXTRA,0,nil)
      local light_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightFusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck_dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckDarkCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("cation dark xyz special " .. Duel.SpecialSummon(dark_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("cation light fusion special " .. Duel.SpecialSummon(light_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("cation light xyz special " .. Duel.SpecialSummon(light_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("cation deck dark special " .. Duel.SpecialSummon(deck_dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "cation-extra-light-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["cation dark xyz special 0", "cation light fusion special 0", "cation light xyz special 1", "cation deck dark special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
