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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Radiant Typhoon WIND special summon lock", () => {
  it("restores its temporary EFFECT_CANNOT_SPECIAL_SUMMON that allows only WIND monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const meghalaCode = "27755794";
    const windCode = "900000297";
    const darkCode = "900000298";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === meghalaCode),
      { code: windCode, name: "Radiant Typhoon WIND Probe", kind: "monster", typeFlags: 0x1, attribute: 0x8, level: 4, attack: 1000, defense: 1000 },
      { code: darkCode, name: "Radiant Typhoon DARK Probe", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 277, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [meghalaCode, windCode, darkCode] }, 1: { main: [] } });
    startDuel(session);

    const meghala = session.state.cards.find((card) => card.code === meghalaCode);
    const wind = session.state.cards.find((card) => card.code === windCode);
    const dark = session.state.cards.find((card) => card.code === darkCode);
    expect(meghala).toBeDefined();
    expect(wind).toBeDefined();
    expect(dark).toBeDefined();
    moveDuelCard(session.state, meghala!.uid, "monsterZone", 0);
    meghala!.position = "faceUpAttack";
    meghala!.faceUp = true;
    moveDuelCard(session.state, wind!.uid, "hand", 0);
    moveDuelCard(session.state, dark!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(meghalaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${meghalaCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${meghalaCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "radiant-typhoon-meghala-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${windCode}),0,LOCATION_HAND,0,nil)
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("radiant typhoon can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,wind)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,dark)))
      Debug.Message("radiant typhoon dark special " .. Duel.SpecialSummon(dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("radiant typhoon wind special " .. Duel.SpecialSummon(wind,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "radiant-typhoon-wind-special-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["radiant typhoon can special true/false", "radiant typhoon dark special 0", "radiant typhoon wind special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
