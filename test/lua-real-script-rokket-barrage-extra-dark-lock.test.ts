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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rokket Barrage Extra DARK lock", () => {
  it("restores its IsAttributeExcept DARK Extra Deck special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const barrageCode = "53481938";
    const darkExtraCode = "900000310";
    const fireExtraCode = "900000311";
    const deckCode = "900000312";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === barrageCode),
      { code: darkExtraCode, name: "Rokket Barrage Dark Extra Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 1, attack: 1000 },
      { code: fireExtraCode, name: "Rokket Barrage Fire Extra Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x4, level: 1, attack: 1000 },
      { code: deckCode, name: "Rokket Barrage Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x4, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5348, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [barrageCode, deckCode], extra: [darkExtraCode, fireExtraCode] }, 1: { main: [] } });
    startDuel(session);
    const barrage = session.state.cards.find((card) => card.code === barrageCode);
    expect(barrage).toBeDefined();
    moveDuelCard(session.state, barrage!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(barrageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const script = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${barrageCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      c${barrageCode}.selfspop(e,0,nil,0,0,nil,0,0)
      `,
      "rokket-barrage-official-selfspop.lua",
    );
    expect(script.ok, script.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-attribute-extra:32",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local dark_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkExtraCode}),0,LOCATION_EXTRA,0,nil)
      local fire_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireExtraCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("rokket barrage fire extra special " .. Duel.SpecialSummon(fire_extra,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rokket barrage dark extra special " .. Duel.SpecialSummon(dark_extra,SUMMON_TYPE_LINK,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rokket barrage deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "rokket-barrage-extra-dark-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["rokket barrage fire extra special 0", "rokket barrage dark extra special 1", "rokket barrage deck special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
