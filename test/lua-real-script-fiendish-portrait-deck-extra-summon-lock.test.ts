import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fiendish Portrait Deck/Extra summon lock", () => {
  it("restores its temporary Deck and Extra Deck Special Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const portraitCode = "1759808";
    const deckCode = "900000290";
    const extraCode = "900000291";
    const handCode = "900000292";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === portraitCode),
      { code: deckCode, name: "Fiendish Portrait Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: extraCode, name: "Fiendish Portrait Extra Probe", kind: "extra", typeFlags: 0x41, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Fiendish Portrait Hand Probe", kind: "monster", typeFlags: 0x1, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1759, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [portraitCode, deckCode, handCode], extra: [extraCode] }, 1: { main: [] } });
    startDuel(session);
    const handProbe = session.state.cards.find((card) => card.code === handCode);
    expect(handProbe).toBeDefined();
    moveDuelCard(session.state, handProbe!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(portraitCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const script = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${portraitCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(aux.Stringid(${portraitCode},2))
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTargetRange(1,0)
      e1:SetTarget(function(e,c) return c:IsLocation(LOCATION_DECK|LOCATION_EXTRA) end)
      e1:SetReset(RESET_PHASE|PHASE_END)
      Duel.RegisterEffect(e1,0)
      `,
      "fiendish-portrait-deck-extra-summon-lock.lua",
    );
    expect(script.ok, script.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:deck-or-extra",
      reset: { flags: 0x40000200 },
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
      reset: { flags: 0x40000200 },
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      local extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("fiendish portrait deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fiendish portrait extra special " .. Duel.SpecialSummon(extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fiendish portrait hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "fiendish-portrait-deck-extra-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fiendish portrait deck special 0",
        "fiendish portrait extra special 0",
        "fiendish portrait hand special 1",
      ]),
    );
  });
});
