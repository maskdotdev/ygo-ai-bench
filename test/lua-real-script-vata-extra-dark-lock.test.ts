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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vata Extra Deck DARK lock", () => {
  it("restores its temporary Extra Deck-only non-DARK special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vataCode = "71187462";
    const extraDarkCode = "900000294";
    const extraLightCode = "900000295";
    const handLightCode = "900000296";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vataCode),
      { code: extraDarkCode, name: "Vata Extra DARK Probe", kind: "monster", typeFlags: 0x41, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: extraLightCode, name: "Vata Extra LIGHT Probe", kind: "monster", typeFlags: 0x41, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: handLightCode, name: "Vata Hand LIGHT Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 711, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vataCode, handLightCode], extra: [extraDarkCode, extraLightCode] }, 1: { main: [] } });
    startDuel(session);

    const vata = session.state.cards.find((card) => card.code === vataCode);
    const handLight = session.state.cards.find((card) => card.code === handLightCode);
    expect(vata).toBeDefined();
    expect(handLight).toBeDefined();
    moveDuelCard(session.state, vata!.uid, "monsterZone", 0);
    vata!.position = "faceUpAttack";
    vata!.faceUp = true;
    moveDuelCard(session.state, handLight!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${vataCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${vataCode}.tgop(e,0,nil,0,0,nil,0,0)
      `,
      "vata-official-tgop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraDarkCode}),0,LOCATION_EXTRA,0,nil)
      local light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraLightCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handLightCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("vata extra light special " .. Duel.SpecialSummon(light,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("vata hand light special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("vata extra dark special " .. Duel.SpecialSummon(dark,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "vata-extra-dark-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["vata extra light special 0", "vata hand light special 1", "vata extra dark special 1"]));

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
