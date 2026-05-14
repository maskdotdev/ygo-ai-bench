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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script QQ Enneagon Extra Rank 9 Xyz lock", () => {
  it("restores its Extra Deck-only Rank 9 or higher Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const qqEnneagonCode = "84673574";
    const level9Code = "900000431";
    const rank9XyzCode = "900000432";
    const rank10XyzCode = "900000433";
    const rank8XyzCode = "900000434";
    const rank10FusionCode = "900000435";
    const deckCode = "900000436";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === qqEnneagonCode),
      { code: level9Code, name: "QQ Enneagon Level 9 Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 9, attack: 1000, defense: 1000 },
      { code: rank9XyzCode, name: "QQ Enneagon Rank 9 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 9, attack: 1000, defense: 1000 },
      { code: rank10XyzCode, name: "QQ Enneagon Rank 10 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 10, attack: 1000, defense: 1000 },
      { code: rank8XyzCode, name: "QQ Enneagon Rank 8 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: rank10FusionCode, name: "QQ Enneagon Rank 10 Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 10, attack: 1000, defense: 1000 },
      { code: deckCode, name: "QQ Enneagon Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 846, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [qqEnneagonCode, level9Code, deckCode], extra: [rank9XyzCode, rank10XyzCode, rank8XyzCode, rank10FusionCode] }, 1: { main: [] } });
    startDuel(session);
    const qqEnneagon = session.state.cards.find((card) => card.code === qqEnneagonCode);
    const level9 = session.state.cards.find((card) => card.code === level9Code);
    expect(qqEnneagon).toBeDefined();
    expect(level9).toBeDefined();
    moveDuelCard(session.state, qqEnneagon!.uid, "hand", 0);
    moveDuelCard(session.state, level9!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(qqEnneagonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${qqEnneagonCode}),0,LOCATION_HAND,0,nil)
      local level9=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${level9Code}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      Duel.SetTargetCard(level9)
      c${qqEnneagonCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "qq-enneagon-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-rank-above-extra:8388608:9",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local rank9=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank9XyzCode}),0,LOCATION_EXTRA,0,nil)
      local rank10=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank10XyzCode}),0,LOCATION_EXTRA,0,nil)
      local rank8=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank8XyzCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank10FusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("qq rank8 xyz special " .. Duel.SpecialSummon(rank8,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("qq rank10 fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("qq rank9 xyz special " .. Duel.SpecialSummon(rank9,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("qq rank10 xyz special " .. Duel.SpecialSummon(rank10,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("qq deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "qq-enneagon-extra-rank9-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "qq rank8 xyz special 0",
        "qq rank10 fusion special 0",
        "qq rank9 xyz special 1",
        "qq rank10 xyz special 1",
        "qq deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
