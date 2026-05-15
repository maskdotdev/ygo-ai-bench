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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Link Devotee Link-3 lock", () => {
  it("restores its Link Summon Link-3 or higher lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const devoteeCode = "48068378";
    const link2Code = "48068379";
    const link3Code = "48068380";
    const fusionCode = "48068381";
    const deckCode = "48068382";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === devoteeCode),
      { code: link2Code, name: "Link Devotee Link-2 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 2, attack: 1000, defense: 0 },
      { code: link3Code, name: "Link Devotee Link-3 Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x10, level: 3, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Link Devotee Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 6, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Link Devotee Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [devoteeCode, deckCode], extra: [link2Code, link3Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(devoteeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${devoteeCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetReset(RESET_PHASE|PHASE_END)
      e1:SetTarget(c${devoteeCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "link-devotee-official-link3-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:link-summon-link-above:3",
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
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local link2=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link2Code}),0,LOCATION_EXTRA,0,nil)
      local link3=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${link3Code}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("link devotee link2 link special " .. Duel.SpecialSummon(link2,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link devotee link3 link special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link devotee link3 fusion special " .. Duel.SpecialSummon(link3,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link devotee fusion link special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("link devotee deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "link-devotee-link3-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "link devotee link2 link special 1",
        "link devotee link3 link special 0",
        "link devotee link3 fusion special 1",
        "link devotee fusion link special 1",
        "link devotee deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
