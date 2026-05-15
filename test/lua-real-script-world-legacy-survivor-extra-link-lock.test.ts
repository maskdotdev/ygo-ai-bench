import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script World Legacy Survivor Extra Link lock", () => {
  it("restores its named Link Extra Deck special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const survivorCode = "31706048";
    const linkCode = "31706049";
    const fusionCode = "31706050";
    const synchroCode = "31706051";
    const deckCode = "31706052";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === survivorCode),
      { code: linkCode, name: "World Legacy Survivor Link Probe", kind: "extra", typeFlags: 0x4000001, race: 0x1000000, attribute: 0x10, level: 2, attack: 1000, defense: 0 },
      { code: fusionCode, name: "World Legacy Survivor Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: synchroCode, name: "World Legacy Survivor Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: deckCode, name: "World Legacy Survivor Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [survivorCode, deckCode], extra: [linkCode, fusionCode, synchroCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(survivorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${survivorCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${survivorCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "world-legacy-survivor-official-extra-link-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-extra:67108864",
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local link=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${linkCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("world legacy survivor fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("world legacy survivor synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("world legacy survivor link special " .. Duel.SpecialSummon(link,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("world legacy survivor deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "world-legacy-survivor-extra-link-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "world legacy survivor fusion special 0",
        "world legacy survivor synchro special 0",
        "world legacy survivor link special 1",
        "world legacy survivor deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
