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
  it("restores its reverse-order non-WATER Extra Deck special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sardineCode = "98684051";
    const waterExtraCode = "98684052";
    const darkExtraCode = "98684053";
    const deckCode = "98684054";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sardineCode),
      { code: waterExtraCode, name: "White Sardine Water Extra Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000000, attribute: 0x2, level: 8, attack: 1000, defense: 1000 },
      { code: darkExtraCode, name: "White Sardine Dark Extra Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000000, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "White Sardine Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 986, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sardineCode, deckCode], extra: [waterExtraCode, darkExtraCode] }, 1: { main: [] } });
    startDuel(session);
    const sardine = session.state.cards.find((card) => card.code === sardineCode);
    expect(sardine).toBeDefined();
    moveDuelCard(session.state, sardine!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sardineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sardineCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      c${sardineCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "white-sardine-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-attribute-extra:2",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local water_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterExtraCode}),0,LOCATION_EXTRA,0,nil)
      local dark_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkExtraCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("white sardine dark extra special " .. Duel.SpecialSummon(dark_extra,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("white sardine water extra special " .. Duel.SpecialSummon(water_extra,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("white sardine deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "white-sardine-extra-water-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["white sardine dark extra special 0", "white sardine water extra special 1", "white sardine deck special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
