import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Palm Ryzeal Extra Rank 4 Xyz lock", () => {
  it("restores its Extra Deck-only Rank 4 Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const palmRyzealCode = "61116514";
    const rank4XyzCode = "900000381";
    const rank5XyzCode = "900000382";
    const fusionCode = "900000383";
    const deckCode = "900000384";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === palmRyzealCode),
      { code: rank4XyzCode, name: "Palm Ryzeal Rank 4 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: rank5XyzCode, name: "Palm Ryzeal Rank 5 Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 5, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Palm Ryzeal Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Palm Ryzeal Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [palmRyzealCode, deckCode], extra: [rank4XyzCode, rank5XyzCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const palmRyzeal = session.state.cards.find((card) => card.code === palmRyzealCode);
    expect(palmRyzeal).toBeDefined();
    moveDuelCard(session.state, palmRyzeal!.uid, "monsterZone", 0);
    palmRyzeal!.faceUp = true;
    palmRyzeal!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(palmRyzealCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-rank-extra:8388608:4",
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
      local rank4=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank4XyzCode}),0,LOCATION_EXTRA,0,nil)
      local rank5=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rank5XyzCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("palm ryzeal rank5 xyz special " .. Duel.SpecialSummon(rank5,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("palm ryzeal fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("palm ryzeal rank4 xyz special " .. Duel.SpecialSummon(rank4,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("palm ryzeal deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "palm-ryzeal-extra-rank4-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "palm ryzeal rank5 xyz special 0",
        "palm ryzeal fusion special 0",
        "palm ryzeal rank4 xyz special 1",
        "palm ryzeal deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
