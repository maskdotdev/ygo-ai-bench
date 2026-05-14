import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Linkbelt Wall Dragon counter Link lock", () => {
  it("restores its handler counter-based Link Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkbeltCode = "63092423";
    const link2Code = "63092424";
    const link3Code = "63092425";
    const fusionCode = "63092426";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkbeltCode),
      { code: link2Code, name: "Linkbelt Wall Dragon Link-2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1000, defense: 0 },
      { code: link3Code, name: "Linkbelt Wall Dragon Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 3, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Linkbelt Wall Dragon Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 630, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkbeltCode], extra: [link2Code, link3Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const linkbelt = session.state.cards.find((card) => card.code === linkbeltCode);
    expect(linkbelt).toBeDefined();
    moveDuelCard(session.state, linkbelt!.uid, "monsterZone", 0);
    linkbelt!.faceUp = true;
    linkbelt!.position = "faceUpAttack";
    expect(addDuelCardCounter(linkbelt, 0x44, 2)).toBe(true);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(linkbeltCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:link-summon-link-above-handler-counter:68",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local link2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link2Code}),0,LOCATION_EXTRA,0,nil)
      local link3=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link3Code}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("linkbelt link2 link special " .. Duel.SpecialSummon(link2,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("linkbelt link3 link special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("linkbelt link3 fusion special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("linkbelt fusion link special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "linkbelt-wall-dragon-counter-link-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "linkbelt link2 link special 1",
        "linkbelt link3 link special 0",
        "linkbelt link3 fusion special 1",
        "linkbelt fusion link special 1",
      ]),
    );
  });
});
