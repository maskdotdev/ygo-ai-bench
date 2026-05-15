import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Garden Rose Flora Extra Synchro lock", () => {
  it("restores its parenthesized Synchro Extra Deck special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const floraCode = "76524506";
    const synchroCode = "76524507";
    const fusionCode = "76524508";
    const xyzCode = "76524509";
    const deckCode = "76524510";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === floraCode),
      { code: synchroCode, name: "Garden Rose Flora Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x400, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Garden Rose Flora Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x400, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: xyzCode, name: "Garden Rose Flora Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x400, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Garden Rose Flora Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x400, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 765, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [floraCode, deckCode], extra: [synchroCode, fusionCode, xyzCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(floraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${floraCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${floraCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "garden-rose-flora-official-extra-synchro-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-extra:8192",
      property: 0x4000800,
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      property: 0x4000800,
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("garden rose flora fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("garden rose flora xyz special " .. Duel.SpecialSummon(xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("garden rose flora synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("garden rose flora deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "garden-rose-flora-extra-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "garden rose flora fusion special 0",
        "garden rose flora xyz special 0",
        "garden rose flora synchro special 1",
        "garden rose flora deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
