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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script White Sardine Extra WATER lock", () => {
  it("restores its reversed-order Extra Deck-only non-WATER special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sardineCode = "98684051";
    const waterExtraCode = "900000316";
    const earthExtraCode = "900000317";
    const earthHandCode = "900000318";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sardineCode),
      { code: waterExtraCode, name: "White Sardine WATER Extra Probe", kind: "monster", typeFlags: 0x41, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: earthExtraCode, name: "White Sardine EARTH Extra Probe", kind: "monster", typeFlags: 0x41, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: earthHandCode, name: "White Sardine EARTH Hand Probe", kind: "monster", typeFlags: 0x1, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 986, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sardineCode, earthHandCode], extra: [waterExtraCode, earthExtraCode] }, 1: { main: [] } });
    startDuel(session);

    const sardine = session.state.cards.find((card) => card.code === sardineCode);
    const earthHand = session.state.cards.find((card) => card.code === earthHandCode);
    expect(sardine).toBeDefined();
    expect(earthHand).toBeDefined();
    moveDuelCard(session.state, sardine!.uid, "hand", 0);
    moveDuelCard(session.state, earthHand!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sardineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sardineCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${sardineCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "white-sardine-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local water_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterExtraCode}),0,LOCATION_EXTRA,0,nil)
      local earth_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${earthExtraCode}),0,LOCATION_EXTRA,0,nil)
      local earth_hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${earthHandCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("white sardine earth extra special " .. Duel.SpecialSummon(earth_extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("white sardine water extra special " .. Duel.SpecialSummon(water_extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("white sardine earth hand special " .. Duel.SpecialSummon(earth_hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "white-sardine-extra-water-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["white sardine earth extra special 0", "white sardine water extra special 1", "white sardine earth hand special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
