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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Power Vice Dragon Extra DARK Synchro lock", () => {
  it("restores its IsSynchroMonster-based Extra Deck-only DARK Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const powerViceCode = "19434243";
    const resonatorCode = "900000341";
    const darkSynchroCode = "900000342";
    const lightSynchroCode = "900000343";
    const darkFusionCode = "900000344";
    const handLightCode = "900000345";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === powerViceCode),
      { code: resonatorCode, name: "Power Vice Resonator Probe", kind: "monster", typeFlags: 0x1, setcodes: [0x57], attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: darkSynchroCode, name: "Power Vice DARK Synchro Probe", kind: "monster", typeFlags: 0x2001, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: lightSynchroCode, name: "Power Vice LIGHT Synchro Probe", kind: "monster", typeFlags: 0x2001, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: darkFusionCode, name: "Power Vice DARK Fusion Probe", kind: "monster", typeFlags: 0x41, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handLightCode, name: "Power Vice Hand LIGHT Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 194, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [powerViceCode, resonatorCode, handLightCode], extra: [darkSynchroCode, lightSynchroCode, darkFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const powerVice = session.state.cards.find((card) => card.code === powerViceCode);
    const handLight = session.state.cards.find((card) => card.code === handLightCode);
    expect(powerVice).toBeDefined();
    expect(handLight).toBeDefined();
    moveDuelCard(session.state, powerVice!.uid, "monsterZone", 0);
    powerVice!.position = "faceUpAttack";
    powerVice!.faceUp = true;
    moveDuelCard(session.state, handLight!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerViceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${powerViceCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${powerViceCode}.thop(e,0,nil,0,0,nil,0,0)
      `,
      "power-vice-official-thop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local dark_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local light_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local dark_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handLightCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("power vice light synchro special " .. Duel.SpecialSummon(light_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("power vice dark fusion special " .. Duel.SpecialSummon(dark_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("power vice dark synchro special " .. Duel.SpecialSummon(dark_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("power vice hand light special " .. Duel.SpecialSummon(hand_light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "power-vice-extra-dark-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "power vice light synchro special 0",
        "power vice dark fusion special 0",
        "power vice dark synchro special 1",
        "power vice hand light special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
