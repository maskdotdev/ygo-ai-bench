import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua field and query helpers", () => {
  it("exposes stable Lua card field ids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Id A", kind: "monster" },
      { code: "200", name: "Field Id B", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local a=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local b=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fid=a:GetFieldID()
      local rfid=a:GetRealFieldID()
      local cid=a:GetCardID()
      Debug.Message("field id stable " .. tostring(fid==a:GetFieldID()) .. "/" .. tostring(fid>0))
      Debug.Message("field id distinct " .. tostring(fid~=b:GetFieldID()))
      Debug.Message("field id matchers " .. tostring(a:IsFieldID(fid)) .. "/" .. tostring(a:IsRealFieldID(rfid)) .. "/" .. tostring(b:IsFieldID(fid)))
      Debug.Message("card id alias " .. tostring(cid==fid) .. "/" .. tostring(cid==a:GetCardID()))
      Debug.Message("card id lookup " .. Duel.GetCardFromCardID(cid):GetCode() .. "/" .. tostring(Duel.GetCardFromCardID(999999)==nil))
      `,
      "card-field-id.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("field id stable true/true");
    expect(host.messages).toContain("field id distinct true");
    expect(host.messages).toContain("field id matchers true/true/false");
    expect(host.messages).toContain("card id alias true/true");
    expect(host.messages).toContain("card id lookup 100/true");
  });

  it("lets Lua scripts read static card data by code", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Static Monster", kind: "monster", typeFlags: 0x21, setcodes: [0x123, 0x456] },
      { code: "200", name: "Static Spell", kind: "spell", typeFlags: 0x10002 },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first,second=Duel.GetCardSetcodeFromCode(100)
      Debug.Message("static type " .. Duel.GetCardTypeFromCode(100) .. "/" .. Duel.GetCardTypeFromCode(200) .. "/" .. Duel.GetCardTypeFromCode(999))
      Debug.Message("static setcodes " .. first .. "/" .. second .. "/" .. select("#",Duel.GetCardSetcodeFromCode(999)))
      `,
      "static-card-data.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("static type 33/65538/0");
    expect(host.messages).toContain("static setcodes 291/1110/0");
  });

  it("exposes Lua summon location and defense availability helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Defender", kind: "monster", typeFlags: 0x21, defense: 1200 },
      { code: "200", name: "Extra Link", kind: "extra", typeFlags: 0x4000021, level: 2, defense: 0 },
      { code: "300", name: "Defense Spell", kind: "spell", typeFlags: 0x2 },
      { code: "400", name: "Trap Zone Monster", kind: "monster", typeFlags: 0x21, defense: 800 },
    ];
    const session = createDuel({ seed: 179, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400"], extra: ["200"] },
      1: { main: [] },
    });
    startDuel(session);
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "100")!.uid, 0);
    const extraSummoned = moveDuelCard(session.state, session.state.cards.find((card) => card.code === "200")!.uid, "monsterZone", 0);
    extraSummoned.summonType = "special";
    extraSummoned.summonPlayer = 0;
    extraSummoned.faceUp = true;
    extraSummoned.position = "faceUpAttack";
    const trapZoneMonster = moveDuelCard(session.state, session.state.cards.find((card) => card.code === "400")!.uid, "spellTrapZone", 0);
    trapZoneMonster.faceUp = true;
    specialSummonDuelCard(session.state, trapZoneMonster.uid, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local hand_summoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra_summoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local st_summoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon locations " .. hand_summoned:GetSummonLocation() .. "/" .. extra_summoned:GetSummonLocation() .. "/" .. st_summoned:GetSummonLocation() .. "/" .. spell:GetSummonLocation())
      Debug.Message("symbolic summon locations " .. tostring(st_summoned:IsSummonLocation(LOCATION_SZONE)) .. "/" .. tostring(st_summoned:IsSummonLocation(LOCATION_STZONE)) .. "/" .. tostring(st_summoned:IsSummonLocation(LOCATION_MZONE)))
      Debug.Message("has defense " .. tostring(hand_summoned:HasDefense()) .. "/" .. tostring(extra_summoned:HasDefense()) .. "/" .. tostring(spell:HasDefense()))
      `,
      "summon-location-defense.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon locations 2/64/8/0");
    expect(host.messages).toContain("symbolic summon locations true/true/false");
    expect(host.messages).toContain("has defense true/false/false");
  });

});
