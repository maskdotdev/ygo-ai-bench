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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vengeful Witch Extra Synchro lock", () => {
  it("restores its IsSynchroMonster-based Extra Deck-only Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const witchCode = "66100116";
    const plantCode = "900000346";
    const synchroCode = "900000347";
    const fusionCode = "900000348";
    const xyzCode = "900000349";
    const handCode = "900000350";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === witchCode),
      { code: plantCode, name: "Vengeful Witch Plant Probe", kind: "monster", typeFlags: 0x1, race: 0x400, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: synchroCode, name: "Vengeful Witch Synchro Probe", kind: "monster", typeFlags: 0x2001, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Vengeful Witch Fusion Probe", kind: "monster", typeFlags: 0x41, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: xyzCode, name: "Vengeful Witch Xyz Probe", kind: "monster", typeFlags: 0x800001, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Vengeful Witch Hand Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 661, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [witchCode, plantCode, handCode], extra: [synchroCode, fusionCode, xyzCode] }, 1: { main: [] } });
    startDuel(session);

    const witch = session.state.cards.find((card) => card.code === witchCode);
    const hand = session.state.cards.find((card) => card.code === handCode);
    expect(witch).toBeDefined();
    expect(hand).toBeDefined();
    moveDuelCard(session.state, witch!.uid, "graveyard", 0);
    moveDuelCard(session.state, hand!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(witchCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${witchCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      c${witchCode}.deckspop(e,0,nil,0,0,nil,0,0)
      `,
      "vengeful-witch-official-deckspop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("vengeful fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("vengeful xyz special " .. Duel.SpecialSummon(xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("vengeful synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("vengeful hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "vengeful-witch-extra-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "vengeful fusion special 0",
        "vengeful xyz special 0",
        "vengeful synchro special 1",
        "vengeful hand special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
