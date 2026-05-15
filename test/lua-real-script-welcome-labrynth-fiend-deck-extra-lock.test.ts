import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Welcome Labrynth Fiend Deck/Extra lock", () => {
  it("restores its temporary Deck and Extra Deck non-Fiend Special Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const welcomeCode = "5380979";
    const fiendDeckCode = "900000300";
    const warriorDeckCode = "900000301";
    const fiendExtraCode = "900000302";
    const warriorExtraCode = "900000303";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === welcomeCode),
      { code: fiendDeckCode, name: "Welcome Labrynth Fiend Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: warriorDeckCode, name: "Welcome Labrynth Warrior Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: fiendExtraCode, name: "Welcome Labrynth Fiend Extra Probe", kind: "extra", typeFlags: 0x41, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: warriorExtraCode, name: "Welcome Labrynth Warrior Extra Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5380, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [welcomeCode, fiendDeckCode, warriorDeckCode], extra: [fiendExtraCode, warriorExtraCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(welcomeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const script = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${welcomeCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(aux.Stringid(${welcomeCode},2))
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetReset(RESET_PHASE|PHASE_END,2)
      e1:SetTarget(function(e,c) return c:IsLocation(LOCATION_DECK|LOCATION_EXTRA) and not c:IsRace(RACE_FIEND) end)
      Duel.RegisterEffect(e1,0)
      `,
      "welcome-labrynth-fiend-deck-extra-lock.lua",
    );
    expect(script.ok, script.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-race-deck-or-extra:8",
      reset: { flags: 0x40000200, count: 2 },
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      reset: { flags: 0x40000200, count: 2 },
      targetRange: [1, 0],
    });
    const probe = restored.host.loadScript(
      `
      local fiendDeck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fiendDeckCode}),0,LOCATION_DECK,0,nil)
      local warriorDeck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorDeckCode}),0,LOCATION_DECK,0,nil)
      local fiendExtra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fiendExtraCode}),0,LOCATION_EXTRA,0,nil)
      local warriorExtra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorExtraCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("welcome labrynth fiend deck special " .. Duel.SpecialSummon(fiendDeck,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("welcome labrynth warrior deck special " .. Duel.SpecialSummon(warriorDeck,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("welcome labrynth fiend extra special " .. Duel.SpecialSummon(fiendExtra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("welcome labrynth warrior extra special " .. Duel.SpecialSummon(warriorExtra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "welcome-labrynth-fiend-deck-extra-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "welcome labrynth fiend deck special 1",
        "welcome labrynth warrior deck special 0",
        "welcome labrynth fiend extra special 1",
        "welcome labrynth warrior extra special 0",
      ]),
    );
  });
});
