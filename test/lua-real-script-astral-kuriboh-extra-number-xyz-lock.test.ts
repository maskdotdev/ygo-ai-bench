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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Astral Kuriboh Extra Number Xyz lock", () => {
  it("restores its Extra Deck-only Number Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const astralKuribohCode = "64591429";
    const numberXyzCode = "900000421";
    const offSetXyzCode = "900000422";
    const numberFusionCode = "900000423";
    const deckCode = "900000424";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === astralKuribohCode),
      { code: numberXyzCode, name: "Astral Kuriboh Number Xyz Probe", kind: "extra", typeFlags: 0x800001, setcodes: [0x48], attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: offSetXyzCode, name: "Astral Kuriboh Off-Set Xyz Probe", kind: "extra", typeFlags: 0x800001, setcodes: [0x123], attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: numberFusionCode, name: "Astral Kuriboh Number Fusion Probe", kind: "extra", typeFlags: 0x41, setcodes: [0x48], attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Astral Kuriboh Deck Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 645, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [astralKuribohCode, deckCode], extra: [numberXyzCode, offSetXyzCode, numberFusionCode] }, 1: { main: [] } });
    startDuel(session);
    const astralKuriboh = session.state.cards.find((card) => card.code === astralKuribohCode);
    expect(astralKuriboh).toBeDefined();
    moveDuelCard(session.state, astralKuriboh!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(astralKuribohCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${astralKuribohCode}),0,LOCATION_HAND,0,nil)
      local number_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${numberXyzCode}),0,LOCATION_EXTRA,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetLabelObject(number_xyz)
      c${astralKuribohCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "astral-kuriboh-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-setcode-type-extra:72:8388608",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local number_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${numberXyzCode}),0,LOCATION_EXTRA,0,nil)
      local off_set_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetXyzCode}),0,LOCATION_EXTRA,0,nil)
      local number_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${numberFusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("astral off-set xyz special " .. Duel.SpecialSummon(off_set_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("astral number fusion special " .. Duel.SpecialSummon(number_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("astral number xyz special " .. Duel.SpecialSummon(number_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("astral deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "astral-kuriboh-extra-number-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "astral off-set xyz special 0",
        "astral number fusion special 0",
        "astral number xyz special 1",
        "astral deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
