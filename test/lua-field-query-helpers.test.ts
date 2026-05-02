import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
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
    ];
    const session = createDuel({ seed: 179, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["200"] },
      1: { main: [] },
    });
    startDuel(session);
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "100")!.uid, 0);
    const extraSummoned = moveDuelCard(session.state, session.state.cards.find((card) => card.code === "200")!.uid, "monsterZone", 0);
    extraSummoned.summonType = "special";
    extraSummoned.summonPlayer = 0;
    extraSummoned.faceUp = true;
    extraSummoned.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local hand_summoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra_summoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon locations " .. hand_summoned:GetSummonLocation() .. "/" .. extra_summoned:GetSummonLocation() .. "/" .. spell:GetSummonLocation())
      Debug.Message("has defense " .. tostring(hand_summoned:HasDefense()) .. "/" .. tostring(extra_summoned:HasDefense()) .. "/" .. tostring(spell:HasDefense()))
      `,
      "summon-location-defense.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon locations 2/64/0");
    expect(host.messages).toContain("has defense true/false/false");
  });

  it("exposes exact Lua card type predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Continuous Trap", kind: "trap", typeFlags: 0x20004 },
      { code: "200", name: "Ritual Spell", kind: "spell", typeFlags: 0x82 },
      { code: "300", name: "Continuous Spell", kind: "spell", typeFlags: 0x20002 },
      { code: "400", name: "Drone Monster", kind: "monster", typeFlags: 0x21, race: 0x2, setcodes: [0x581] },
      { code: "500", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
      { code: "95453143", name: "Known Red", kind: "monster", typeFlags: 0x21 },
      { code: "89631139", name: "Known White", kind: "monster", typeFlags: 0x21 },
      { code: "600", name: "Setcode Red", kind: "monster", typeFlags: 0x21, setcodes: [0x1045] },
      { code: "700", name: "Setcode White", kind: "monster", typeFlags: 0x21, setcodes: [0x55d] },
      { code: "800", name: "Action Spell", kind: "spell", typeFlags: 0x10000002 },
      { code: "801", name: "Action Trap", kind: "trap", typeFlags: 0x10000004 },
      { code: "802", name: "Action Field", kind: "spell", typeFlags: 0x10080002 },
      { code: "806", name: "Equip Trap", kind: "trap", typeFlags: 0x40004 },
      { code: "808", name: "Normal Trap", kind: "trap", typeFlags: 0x4 },
      { code: "812", name: "Counter Trap", kind: "trap", typeFlags: 0x100004 },
      { code: "814", name: "Link Spell", kind: "spell", typeFlags: 0x4000002 },
      { code: "82382815", name: "Champion Code", kind: "spell", typeFlags: 0x2 },
      { code: "803", name: "Champion Set", kind: "monster", typeFlags: 0x21, setcodes: [0x152f] },
      { code: "7391448", name: "Goyo Code", kind: "monster", typeFlags: 0x21 },
      { code: "807", name: "Goyo Set", kind: "monster", typeFlags: 0x21, setcodes: [0x523] },
      { code: "90276649", name: "Melodious Songtress Code", kind: "monster", typeFlags: 0x21 },
      { code: "809", name: "Melodious Songtress Set", kind: "monster", typeFlags: 0x21, setcodes: [0x209b] },
      { code: "92341815", name: "Papillon Code", kind: "monster", typeFlags: 0x21 },
      { code: "810", name: "Papillon Set", kind: "monster", typeFlags: 0x21, setcodes: [0x53c] },
      { code: "7500772", name: "Shark Code", kind: "monster", typeFlags: 0x21 },
      { code: "811", name: "Shark Set", kind: "monster", typeFlags: 0x21, setcodes: [0x547] },
      { code: "42685062", name: "Earth Code", kind: "monster", typeFlags: 0x21 },
      { code: "804", name: "Earthbound Set", kind: "monster", typeFlags: 0x21, setcodes: [0x21] },
      { code: "36029076", name: "Hell Code", kind: "monster", typeFlags: 0x21 },
      { code: "49771608", name: "Sky Code", kind: "monster", typeFlags: 0x21 },
      { code: "805", name: "Sky Set", kind: "monster", typeFlags: 0x21, setcodes: [0x54a] },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 31, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "95453143", "89631139", "600", "700", "800", "801", "802", "806", "808", "812", "814", "82382815", "803", "7391448", "807", "90276649", "809", "92341815", "810", "7500772", "811", "42685062", "804", "36029076", "49771608", "805"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local continuous_trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ritual_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local continuous_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local drone=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local known_red=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 95453143), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local known_white=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 89631139), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local setcode_red=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local setcode_white=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local action_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local action_trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 801), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local action_field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 802), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local equip_trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 806), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal_trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 808), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local counter_trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 812), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local link_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 814), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local champion_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 82382815), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local champion_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 803), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local goyo_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 7391448), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local goyo_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 807), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local melodious_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 90276649), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local melodious_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 809), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local papillon_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 92341815), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local papillon_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 810), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local shark_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 7500772), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local shark_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 811), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local earth_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 42685062), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local earth_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 804), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local hell_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 36029076), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local sky_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 49771608), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local sky_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 805), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("exact type constants " .. TYPE_CONTINUOUS)
      Debug.Message("continuous trap " .. tostring(continuous_trap:IsContinuousTrap()) .. "/" .. tostring(continuous_trap:IsContinuousSpell()) .. "/" .. tostring(continuous_trap:IsRitualSpell()))
      Debug.Message("ritual spell " .. tostring(ritual_spell:IsRitualSpell()) .. "/" .. tostring(ritual_spell:IsContinuousTrap()))
      Debug.Message("continuous spell " .. tostring(continuous_spell:IsContinuousSpell()) .. "/" .. tostring(normal_spell:IsContinuousSpell()))
      Debug.Message("normal spell " .. tostring(normal_spell:IsNormalSpell()) .. "/" .. tostring(continuous_spell:IsNormalSpell()) .. "/" .. tostring(link_spell:IsNormalSpell()))
      Debug.Message("normal spelltrap " .. tostring(normal_spell:IsNormalSpellTrap()) .. "/" .. tostring(normal_trap:IsNormalSpellTrap()) .. "/" .. tostring(continuous_spell:IsNormalSpellTrap()))
      Debug.Message("continuous spelltrap " .. tostring(continuous_trap:IsContinuousSpellTrap()) .. "/" .. tostring(continuous_spell:IsContinuousSpellTrap()) .. "/" .. tostring(ritual_spell:IsContinuousSpellTrap()) .. "/" .. tostring(normal_spell:IsContinuousSpellTrap()))
      Debug.Message("equip trap " .. tostring(equip_trap:IsEquipTrap()) .. "/" .. tostring(equip_trap:IsEquipCard()) .. "/" .. tostring(continuous_trap:IsEquipTrap()))
      Debug.Message("normal trap " .. tostring(normal_trap:IsNormalTrap()) .. "/" .. tostring(continuous_trap:IsNormalTrap()) .. "/" .. tostring(equip_trap:IsNormalTrap()) .. "/" .. tostring(action_trap:IsNormalTrap()))
      Debug.Message("counter trap " .. tostring(counter_trap:IsCounterTrap()) .. "/" .. tostring(normal_trap:IsCounterTrap()) .. "/" .. tostring(continuous_trap:IsCounterTrap()))
      Debug.Message("link spell " .. tostring(link_spell:IsLinkSpell()) .. "/" .. tostring(normal_spell:IsLinkSpell()))
      Debug.Message("drone predicate " .. tostring(drone:IsDrone()) .. "/" .. tostring(normal_spell:IsDrone()))
      Debug.Message("action predicates " .. TYPE_ACTION .. "/" .. tostring(action_spell:IsActionCard()) .. "/" .. tostring(action_spell:IsActionSpell()) .. "/" .. tostring(action_trap:IsActionTrap()) .. "/" .. tostring(action_field:IsActionField()) .. "/" .. tostring(action_field:IsActionCard()))
      Debug.Message("champion predicates " .. tostring(champion_code:IsChampion()) .. "/" .. tostring(champion_set:IsChampion()) .. "/" .. tostring(normal_spell:IsChampion()))
      Debug.Message("goyo predicates " .. tostring(goyo_code:IsGoyo()) .. "/" .. tostring(goyo_set:IsGoyo()) .. "/" .. tostring(normal_spell:IsGoyo()))
      Debug.Message("melodious songtress predicates " .. tostring(melodious_code:IsMelodiousSongtress()) .. "/" .. tostring(melodious_set:IsMelodiousSongtress()) .. "/" .. tostring(normal_spell:IsMelodiousSongtress()))
      Debug.Message("papillon predicates " .. tostring(papillon_code:IsPapillon()) .. "/" .. tostring(papillon_set:IsPapillon()) .. "/" .. tostring(normal_spell:IsPapillon()))
      Debug.Message("shark predicates " .. tostring(shark_code:IsShark()) .. "/" .. tostring(shark_set:IsShark()) .. "/" .. tostring(normal_spell:IsShark()))
      Debug.Message("earth predicates " .. tostring(earth_code:IsEarth()) .. "/" .. tostring(earth_set:IsEarth()) .. "/" .. tostring(normal_spell:IsEarth()))
      Debug.Message("hell earth exclusion " .. tostring(hell_code:IsHell()) .. "/" .. tostring(hell_code:IsEarth()))
      Debug.Message("sky predicates " .. tostring(sky_code:IsSky()) .. "/" .. tostring(sky_set:IsSky()) .. "/" .. tostring(normal_spell:IsSky()))
      Debug.Message("set/race helpers " .. drone:GetSetCard() .. "/" .. tostring(drone:IsRaceExcept(RACE_DRAGON)) .. "/" .. tostring(drone:IsRaceExcept(RACE_SPELLCASTER|RACE_DRAGON)))
      Debug.Message("anime colors " .. tostring(known_red:IsRed()) .. "/" .. tostring(setcode_red:IsRed()) .. "/" .. tostring(known_white:IsWhite()) .. "/" .. tostring(setcode_white:IsWhite()) .. "/" .. tostring(normal_spell:IsRed()) .. "/" .. tostring(normal_spell:IsWhite()))
      `,
      "exact-card-type-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("exact type constants 131072");
    expect(host.messages).toContain("continuous trap true/false/false");
    expect(host.messages).toContain("ritual spell true/false");
    expect(host.messages).toContain("continuous spell true/false");
    expect(host.messages).toContain("normal spell true/false/false");
    expect(host.messages).toContain("normal spelltrap true/true/false");
    expect(host.messages).toContain("continuous spelltrap true/true/false/false");
    expect(host.messages).toContain("equip trap true/true/false");
    expect(host.messages).toContain("normal trap true/false/false/false");
    expect(host.messages).toContain("counter trap true/false/false");
    expect(host.messages).toContain("link spell true/false");
    expect(host.messages).toContain("drone predicate true/false");
    expect(host.messages).toContain("action predicates 268435456/true/true/true/true/false");
    expect(host.messages).toContain("champion predicates true/true/false");
    expect(host.messages).toContain("goyo predicates true/true/false");
    expect(host.messages).toContain("melodious songtress predicates true/true/false");
    expect(host.messages).toContain("papillon predicates true/true/false");
    expect(host.messages).toContain("shark predicates true/true/false");
    expect(host.messages).toContain("earth predicates true/true/false");
    expect(host.messages).toContain("hell earth exclusion true/false");
    expect(host.messages).toContain("sky predicates true/true/false");
    expect(host.messages).toContain("set/race helpers 1409/true/false");
    expect(host.messages).toContain("anime colors true/true/true/true/false/false");
  }, 30000);

  it("exposes anime archetype predicates from code and setcode checks", () => {
    const cases = [
      { method: "IsAlligator", code: "39984786", setcode: 0x502 },
      { method: "IsAngel", code: "79575620", setcode: 0x154a },
      { method: "IsAncientGearGolem", code: "83104731", setcode: 0x581 },
      { method: "IsAnti", code: "43583400", setcode: 0x503 },
      { method: "IsAssassin", code: "48365709", setcode: 0x504 },
      { method: "IsAstral", code: "64591429", setcode: 0x505 },
      { method: "IsAtlandis", code: "9161357", setcode: 0x506 },
      { method: "IsBlackwingTamer", code: "81983656", setcode: 0x2033 },
      { method: "IsButterfly", code: "16984449", setcode: 0x50c },
      { method: "IsC", code: "15862758", setcode: 0x1048 },
      { method: "IsCat", code: "19963185", setcode: 0x50e },
      { method: "IsCelestial", code: "69865139", setcode: 0x254a },
      { method: "IsCenozoic", code: "12015000", setcode: 0x57c },
      { method: "IsCicada", code: "4997565", setcode: 0x50f },
      { method: "IsClear", code: "97811903", setcode: 0x510 },
      { method: "IsCN39UtopiaRay", code: "56840427", setcode: 0x1539 },
      { method: "IsComicsHero", code: "77631175", setcode: 0x511 },
      { method: "IsCubicSeed", code: "15610297", setcode: 0x10e3 },
      { method: "IsDarkness", code: "18967507", setcode: 0x316 },
      { method: "IsDart", code: "43061293", setcode: 0x513 },
      { method: "IsDice", code: "16725505", setcode: 0x514 },
      { method: "IsDog", code: "72714226", setcode: 0x516 },
      { method: "IsDoll", code: "85639257", setcode: 0x517 },
      { method: "IsDruid", code: "24062258", setcode: 0x8c },
      { method: "IsDyson", code: "1992816", setcode: 0x519 },
      { method: "IsEarthboundServant", code: "8690387", setcode: 0x2021 },
      { method: "IsElf", code: "44663232", setcode: 0x51b },
      { method: "IsEmissaryOfDarkness", code: "44330098", setcode: 0x51c },
      { method: "IsFairy", code: "25862681", setcode: 0x51d },
      { method: "IsForest", code: "77797992", setcode: 0x51f },
      { method: "IsFortressWhale", code: "62337487", setcode: 0x583 },
      { method: "IsGaiatheDragonChampion", code: "66889139", setcode: 0x580 },
      { method: "IsGemKnightLady", code: "47611119", setcode: 0x3047 },
      { method: "IsGorgonic", code: "64379261", setcode: 0x522 },
      { method: "IsGranel", code: "2137678", setcode: 0x524 },
      { method: "IsHand", code: "95929069", setcode: 0x527 },
      { method: "IsHarpieLadySisters", code: "12206212", setcode: 0x1064 },
      { method: "IsHelios", code: "54493213", setcode: 0 },
      { method: "IsHell", code: "36029076", setcode: 0x567 },
      { method: "IsHeraldic", code: "23649496", setcode: 0x566 },
      { method: "IsHeavyIndustry", code: "42851643", setcode: 0x529 },
      { method: "IsHunder", code: "71438011", setcode: 0x565 },
      { method: "IsInsectQueen", code: "91512835", setcode: 0x582 },
      { method: "IsInu", code: "79182538", setcode: 0x52a },
      { method: "IsIvy", code: "30069398", setcode: 0x52b },
      { method: "IsJester", code: "94703021", setcode: 0x52c },
      { method: "IsJutte", code: "60410769", setcode: 0x52d },
      { method: "IsKangaroo", code: "78613627", setcode: 0 },
      { method: "IsKing", code: "60990740", setcode: 0x52f },
      { method: "IsKnight", code: "24435369", setcode: 0x530 },
      { method: "IsLamp", code: "24434049", setcode: 0x532 },
      { method: "IsLandstar", code: "3573512", setcode: 0x533 },
      { method: "IsMantis", code: "58818411", setcode: 0x535 },
      { method: "IsMask", code: "29549364", setcode: 0x583 },
      { method: "IsMesozoic", code: "83656563", setcode: 0x57d },
      { method: "IsMonarch", code: "4929256", setcode: 0x571 },
      { method: "IsMosquito", code: "94113093", setcode: 0x536 },
      { method: "IsMotor", code: "82556058", setcode: 0x537 },
      { method: "IsN39Utopia", code: "56832966", setcode: 0x539 },
      { method: "IsNeko", code: "8634636", setcode: 0x538 },
      { method: "IsPaleozoic", code: "21225115", setcode: 0x57e },
      { method: "IsParasite", code: "49966595", setcode: 0x53d },
      { method: "IsPhantomButterfly", code: "63630268", setcode: 0x150c },
      { method: "IsPixie", code: "44663232", setcode: 0x53e },
      { method: "IsPriestess", code: "95511642", setcode: 0x53f },
      { method: "IsRaccoon", code: "92729410", setcode: 0x542 },
      { method: "IsSeal", code: "63102017", setcode: 0x545 },
      { method: "IsShaman", code: "97870394", setcode: 0x546 },
      { method: "IsStarvingVenemy", code: "22070401", setcode: 0x576 },
      { method: "IsShining", code: "22061412", setcode: 0x548 },
      { method: "IsSkiel", code: "31930787", setcode: 0x549 },
      { method: "IsSlime", code: "68638985", setcode: 0x54b },
      { method: "IsSphere", code: "60202749", setcode: 0x54c },
      { method: "IsStarship", code: "15458892", setcode: 0x54f },
      { method: "IsStatue", code: "44822037", setcode: 0x550 },
      { method: "IsStone", code: "9540040", setcode: 0x551 },
      { method: "IsTachyon", code: "8038143", setcode: 0x555 },
      { method: "IsTachyonDragon", code: "88177324", setcode: 0x1555 },
      { method: "IsTheWingedDragonofRa", code: "10000010", setcode: 0x584 },
      { method: "IsToy", code: "56675280", setcode: 0x559 },
      { method: "IsToyArcV", code: "9001", setcode: 0x558, codeMatches: false },
      { method: "IsV", code: "97574404", setcode: 0x55a },
      { method: "IsW", code: "23846921", setcode: 0x56b },
      { method: "IsWisel", code: "68140974", setcode: 0x560 },
      { method: "IsX", code: "18000338", setcode: 0x56c },
      { method: "IsY", code: "23915499", setcode: 0x56d },
      { method: "IsYomi", code: "12538374", setcode: 0x563 },
      { method: "IsZ", code: "50319138", setcode: 0x56e },
      { method: "Is_V_", code: "33725002", setcode: 0x155a },
    ];
    for (let index = 0; index < cases.length; index += 12) {
      expectAnimeArchetypePredicates(cases.slice(index, index + 12), 158 + index);
    }
  }, 60000);

  it("keeps Phantom Butterfly out of the generic Butterfly predicate", () => {
    const cards: DuelCardData[] = [
      { code: "63630268", name: "Butterspy Protection", kind: "trap", typeFlags: 0x4 },
      { code: "9001", name: "Phantom Butterfly Set", kind: "monster", typeFlags: 0x21, setcodes: [0x150c] },
    ];
    const session = createDuel({ seed: 159, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["63630268", "9001"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local by_code=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 63630268), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local by_set=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 9001), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("phantom butterfly " .. tostring(by_code:IsPhantomButterfly()) .. "/" .. tostring(by_set:IsPhantomButterfly()))
      Debug.Message("generic butterfly " .. tostring(by_code:IsButterfly()) .. "/" .. tostring(by_set:IsButterfly()))
      `,
      "phantom-butterfly-exclusion.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("phantom butterfly true/true");
    expect(host.messages).toContain("generic butterfly false/false");
  });

  it("lets Lua scripts identify exact Virus card codes", () => {
    const cards: DuelCardData[] = [
      { code: "86361354", name: "Virus Code", kind: "monster", typeFlags: 0x21 },
      { code: "9000", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
      { code: "9001", name: "Alias Virus", kind: "monster", typeFlags: 0x21, alias: "86361354" },
    ];
    const session = createDuel({ seed: 307, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["86361354", "9000", "9001"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local virus=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 86361354), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 9000), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local alias=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 9001), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("virus exact " .. tostring(virus:IsVirus()) .. "/" .. tostring(normal:IsVirus()) .. "/" .. tostring(alias:IsVirus()))
      `,
      "virus-code-predicate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("virus exact true/false/false");
  });

  function expectAnimeArchetypePredicates(cases: { method: string; code: string; setcode: number; codeMatches?: boolean }[], seed: number): void {
    const cards: DuelCardData[] = [{ code: "9000", name: "Normal Spell", kind: "spell", typeFlags: 0x2 }];
    const main = ["9000"];
    for (const [index, fixture] of cases.entries()) {
      const setCodeCard = String(9100 + index);
      cards.push(
        { code: fixture.code, name: `${fixture.method} Code`, kind: "monster", typeFlags: 0x21 },
        { code: setCodeCard, name: `${fixture.method} Set`, kind: "monster", typeFlags: 0x21, setcodes: fixture.setcode === 0 ? [] : [fixture.setcode] },
      );
      main.push(fixture.code, setCodeCard);
    }
    const session = createDuel({ seed, startingHandSize: main.length, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const luaCases = cases.map((fixture, index) => `{ "${fixture.method}", ${fixture.code}, ${9100 + index} }`).join(",\n");
    const result = host.loadScript(
      `
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 9000), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local cases={${luaCases}}
      for _, fixture in ipairs(cases) do
        local method=fixture[1]
        local code_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, fixture[2]), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
        local set_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, fixture[3]), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
        Debug.Message(method .. " " .. tostring(code_card[method](code_card)) .. "/" .. tostring(set_card[method](set_card)) .. "/" .. tostring(normal[method](normal)))
      end
      `,
      "anime-archetype-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    for (const fixture of cases) expect(host.messages).toContain(`${fixture.method} ${fixture.codeMatches === false ? "false" : "true"}/${fixture.setcode === 0 ? "false" : "true"}/false`);
  }

  it("lets Lua scripts check linked monster-zone cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Right Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0x20 },
      { code: "200", name: "Co-linked Monster", kind: "extra", typeFlags: 0x4000001, level: 1, linkMarkers: 0x8 },
      { code: "300", name: "Unlinked Monster", kind: "monster", typeFlags: 0x21 },
      { code: "400", name: "Left Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0x8 },
    ];
    const session = createDuel({ seed: 45, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200", "300"], extra: ["100", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const link = session.state.cards.find((card) => card.code === "100");
    const leftLink = session.state.cards.find((card) => card.code === "400");
    const linked = session.state.cards.find((card) => card.code === "200");
    const unlinked = session.state.cards.find((card) => card.code === "300");
    expect(link).toBeDefined();
    expect(leftLink).toBeDefined();
    expect(linked).toBeDefined();
    expect(unlinked).toBeDefined();
    const movedLink = moveDuelCard(session.state, link!.uid, "monsterZone", 0);
    const movedLeftLink = moveDuelCard(session.state, leftLink!.uid, "monsterZone", 0);
    const movedLinked = moveDuelCard(session.state, linked!.uid, "monsterZone", 0);
    const movedUnlinked = moveDuelCard(session.state, unlinked!.uid, "monsterZone", 0);
    movedLink.faceUp = true;
    movedLeftLink.faceUp = true;
    movedLinked.faceUp = true;
    movedUnlinked.faceUp = true;
    movedLink.position = "faceUpAttack";
    movedLeftLink.position = "faceUpAttack";
    movedLinked.position = "faceUpAttack";
    movedUnlinked.position = "faceUpAttack";
    movedLink.sequence = 0;
    movedLinked.sequence = 1;
    movedLeftLink.sequence = 2;
    movedUnlinked.sequence = 4;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local link=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local linked=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      local unlinked=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local link_group=Duel.GetMatchingGroup(Card.IsLinkMonster,0,LOCATION_MZONE,0,nil)
      local linked_group=link:GetLinkedGroup()
      local duel_linked_group=Duel.GetLinkedGroup(0,LOCATION_MZONE,0)
      Debug.Message("linked checks " .. tostring(link:IsLinked()) .. "/" .. tostring(linked:IsLinked()) .. "/" .. tostring(unlinked:IsLinked()))
      Debug.Message("co-linked checks " .. tostring(link:IsCoLinked()) .. "/" .. tostring(link:IsCoLinked(2)) .. "/" .. tostring(linked:IsCoLinked()) .. "/" .. tostring(unlinked:IsCoLinked()))
      Debug.Message("linked zone counts " .. Duel.GetZoneWithLinkedCount(1,0) .. "/" .. Duel.GetZoneWithLinkedCount(2,0))
      Debug.Message("linked zones " .. link:GetLinkedZone(0) .. "/" .. Duel.GetLinkedZone(0) .. "/" .. link_group:GetLinkedZone(0) .. "/" .. Duel.GetLinkedZone(1))
      Debug.Message("mmz pointed " .. aux.GetMMZonesPointedTo(0) .. "/" .. aux.GetMMZonesPointedTo(0,Card.IsCode,LOCATION_MZONE,0,nil,100) .. "/" .. aux.GetMMZonesPointedTo(0,Card.IsCode,LOCATION_MZONE,0,nil,400))
      local eg=Group.FromCards(linked,unlinked)
      local zpt=aux.zptgroup(eg,Card.IsFaceup,link,0)
      local zpt_condition=aux.zptcon(Card.IsFaceup)
      local e=Effect.CreateEffect(link)
      Debug.Message("group to be linked zone " .. eg:GetToBeLinkedZone(link,0,false,false) .. "/" .. Group.GetToBeLinkedZone(eg,link,0,true,false))
      Debug.Message("zpt helpers " .. zpt:GetCount() .. "/" .. tostring(zpt:IsContains(linked)) .. "/" .. tostring(zpt:IsContains(unlinked)) .. "/" .. tostring(aux.zptgroupcon(eg,Card.IsFaceup,link,0)) .. "/" .. tostring(zpt_condition(e,0,eg,0,0,nil,0,0)))
      Debug.Message("linked group " .. linked_group:GetCount() .. "/" .. link:GetLinkedGroupCount() .. "/" .. tostring(linked_group:IsContains(linked)) .. "/" .. tostring(linked_group:IsContains(unlinked)))
      Debug.Message("duel linked group " .. duel_linked_group:GetCount() .. "/" .. tostring(duel_linked_group:IsContains(linked)) .. "/" .. Duel.GetLinkedGroup(1,LOCATION_MZONE,0):GetCount())
      `,
      "linked-card-predicate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("linked checks true/true/false");
    expect(host.messages).toContain("co-linked checks true/false/true/false");
    expect(host.messages).toContain("linked zone counts 3/2");
    expect(host.messages).toContain("linked zones 2/3/3/0");
    expect(host.messages).toContain("mmz pointed 3/2/2");
    expect(host.messages).toContain("group to be linked zone 9/1");
    expect(host.messages).toContain("zpt helpers 1/true/false/true/true");
    expect(host.messages).toContain("linked group 1/1/true/false");
    expect(host.messages).toContain("duel linked group 2/true/0");
  });

  it("lets Lua scripts check Rikka releasable cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Plant Monster", kind: "monster", typeFlags: 0x21, race: 0x400 },
      { code: "200", name: "Konkon Target", kind: "monster", typeFlags: 0x21, race: 0x2 },
      { code: "300", name: "Plain Monster", kind: "monster", typeFlags: 0x21, race: 0x2 },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const plant = session.state.cards.find((card) => card.code === "100");
    const konkonTarget = session.state.cards.find((card) => card.code === "200");
    const plain = session.state.cards.find((card) => card.code === "300");
    expect(plant).toBeDefined();
    expect(konkonTarget).toBeDefined();
    expect(plain).toBeDefined();
    moveDuelCard(session.state, plant!.uid, "monsterZone", 0);
    moveDuelCard(session.state, konkonTarget!.uid, "monsterZone", 1);
    moveDuelCard(session.state, plain!.uid, "monsterZone", 1);
    plant!.sequence = 0;
    konkonTarget!.sequence = 0;
    plain!.sequence = 1;
    plant!.faceUp = true;
    konkonTarget!.faceUp = true;
    plain!.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local plant = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local konkon = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local plain = Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local e = Effect.CreateEffect(konkon)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(CARD_RIKKA_KONKON)
      e:SetRange(LOCATION_MZONE)
      konkon:RegisterEffect(e)
      Debug.Message("rikka constants " .. RACE_PLANT .. "/" .. CARD_RIKKA_KONKON)
      Debug.Message("rikka releasable " .. tostring(plant:IsRikkaReleasable(0)) .. "/" .. tostring(konkon:IsRikkaReleasable(0)) .. "/" .. tostring(plain:IsRikkaReleasable(0)) .. "/" .. tostring(konkon:IsRikkaReleasable(1)))
      `,
      "rikka-releasable.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("rikka constants 1024/76869711");
    expect(host.messages).toContain("rikka releasable true/true/false/false");
  });

  it("lets Lua scripts query monster zones and choose summon positions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Filler A", kind: "monster" },
      { code: "200", name: "Zone Filler B", kind: "monster" },
      { code: "300", name: "Zone Filler C", kind: "monster" },
      { code: "400", name: "Zone Filler D", kind: "monster" },
      { code: "500", name: "Zone Filler E", kind: "monster" },
      { code: "600", name: "Position Summon", kind: "monster" },
    ];
    const session = createDuel({ seed: 10, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("phase checks " .. Duel.GetCurrentPhase() .. "/" .. tostring(Duel.IsPhase(PHASE_MAIN1)) .. "/" .. tostring(Duel.IsPhase(PHASE_BATTLE + PHASE_END)))
      Debug.Message("location count " .. Duel.GetLocationCount(0, LOCATION_MZONE))
      Debug.Message("mzone count " .. Duel.GetMZoneCount(0))
      Debug.Message("mzone with excluded " .. Duel.GetMZoneCount(0, excluded))
      Debug.Message("ex count " .. Duel.GetLocationCountFromEx(0, 0, nil, excluded))
      Debug.Message("mzone seq0 open " .. tostring(Duel.CheckLocation(0, LOCATION_MZONE, 0)))
      Debug.Message("szone seq0 open " .. tostring(Duel.CheckLocation(0, LOCATION_SZONE, 0)))
      local selected = Duel.SelectPosition(0, nil, POS_FACEUP_DEFENSE + POS_FACEDOWN_DEFENSE)
      Debug.Message("selected position " .. selected)
      local summon = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil)
      local summon_card = summon:GetFirst()
      Debug.Message("can normal full " .. tostring(Duel.IsPlayerCanSummon(0, summon_card)))
      Debug.Message("can mset full " .. tostring(Duel.IsPlayerCanMSet(0, summon_card)))
      Debug.Message("can special full " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, selected, 0, summon_card)))
      Debug.Message("can special opponent " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, selected, 1, summon_card)))
      Debug.Message("summoned " .. Duel.SpecialSummon(summon, 0, 0, 1, false, false, selected))
      `,
      "summon-position.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("phase checks 4/true/false");
    expect(host.messages).toContain("location count 0");
    expect(host.messages).toContain("mzone count 0");
    expect(host.messages).toContain("mzone with excluded 1");
    expect(host.messages).toContain("ex count 1");
    expect(host.messages).toContain("mzone seq0 open false");
    expect(host.messages).toContain("szone seq0 open true");
    expect(host.messages).toContain("selected position 4");
    expect(host.messages).toContain("can normal full false");
    expect(host.messages).toContain("can mset full false");
    expect(host.messages).toContain("can special full false");
    expect(host.messages).toContain("can special opponent true");
    expect(host.messages).toContain("summoned 1");
    const summoned = session.state.cards.find((card) => card.code === "600");
    expect(summoned?.controller).toBe(1);
    expect(summoned?.location).toBe("monsterZone");
    expect(summoned?.position).toBe("faceUpDefense");
  });

  it("lets Lua scripts check adjacent open monster zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Center Monster", kind: "monster" },
      { code: "200", name: "Left Filler", kind: "monster" },
      { code: "300", name: "Right Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 154, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const center = session.state.cards.find((card) => card.code === "100");
    const left = session.state.cards.find((card) => card.code === "200");
    const right = session.state.cards.find((card) => card.code === "300");
    expect(center).toBeDefined();
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    moveDuelCard(session.state, center!.uid, "monsterZone", 0);
    moveDuelCard(session.state, left!.uid, "monsterZone", 0);
    center!.sequence = 2;
    left!.sequence = 1;

    const host = createLuaScriptHost(session);
    const open = host.loadScript(
      `
      local center = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("adjacent open " .. tostring(center:CheckAdjacent()))
      `,
      "adjacent-open.lua",
    );
    expect(open.ok, open.error).toBe(true);
    expect(host.messages).toContain("adjacent open true");

    moveDuelCard(session.state, right!.uid, "monsterZone", 0);
    center!.sequence = 2;
    left!.sequence = 1;
    right!.sequence = 3;
    const blocked = host.loadScript(
      `
      local center = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("adjacent blocked " .. tostring(center:CheckAdjacent()))
      `,
      "adjacent-blocked.lua",
    );
    expect(blocked.ok, blocked.error).toBe(true);
    expect(host.messages).toContain("adjacent blocked false");
  });

  it("lets Lua scripts distinguish main and extra monster zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Main Zone Monster", kind: "monster" },
      { code: "200", name: "Extra Zone Monster", kind: "monster" },
      { code: "300", name: "Opponent Main Zone Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 155, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);

    const main = session.state.cards.find((card) => card.code === "100");
    const extra = session.state.cards.find((card) => card.code === "200");
    const opponent = session.state.cards.find((card) => card.code === "300");
    expect(main).toBeDefined();
    expect(extra).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, main!.uid, "monsterZone", 0);
    main!.sequence = 2;
    moveDuelCard(session.state, extra!.uid, "monsterZone", 0);
    extra!.sequence = 5;
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    opponent!.sequence = 4;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local main = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("main mzone " .. tostring(main:IsInMainMZone()) .. "/" .. tostring(main:IsInExtraMZone()) .. "/" .. tostring(main:IsInMainMZone(0)) .. "/" .. tostring(main:IsInMainMZone(1)))
      Debug.Message("extra mzone " .. tostring(extra:IsInMainMZone()) .. "/" .. tostring(extra:IsInExtraMZone()) .. "/" .. tostring(extra:IsInExtraMZone(0)) .. "/" .. tostring(extra:IsInExtraMZone(1)))
      Debug.Message("opponent main mzone " .. tostring(Card.IsInMainMZone(opponent,1)) .. "/" .. tostring(Card.IsInMainMZone(opponent,0)))
      `,
      "main-extra-mzone.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("main mzone true/false/true/false");
    expect(host.messages).toContain("extra mzone false/true/true/false");
    expect(host.messages).toContain("opponent main mzone true/false");
  });

  it("lets Lua scripts check pendulum zone availability", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pendulum Zone Left", kind: "spell" },
      { code: "200", name: "Pendulum Zone Right", kind: "spell" },
    ];
    const session = createDuel({ seed: 90, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const left = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const right = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();

    const host = createLuaScriptHost(session);
    const open = host.loadScript(
      `
      Debug.Message("pzone constant " .. LOCATION_PZONE)
      Debug.Message("pzone open " .. tostring(Duel.CheckPendulumZones(0)) .. "/" .. Duel.GetLocationCount(0, LOCATION_PZONE))
      Debug.Message("pzone left open " .. tostring(Duel.CheckLocation(0, LOCATION_PZONE, 0)))
      `,
      "pendulum-zones-open.lua",
    );

    expect(open.ok, open.error).toBe(true);
    expect(host.messages).toContain("pzone constant 512");
    expect(host.messages).toContain("pzone open true/2");
    expect(host.messages).toContain("pzone left open true");

    moveDuelCard(session.state, left!.uid, "spellTrapZone", 0);
    left!.sequence = 0;
    moveDuelCard(session.state, right!.uid, "spellTrapZone", 0);
    right!.sequence = 1;
    const closed = host.loadScript(
      `
      Debug.Message("pzone closed " .. tostring(Duel.CheckPendulumZones(0)) .. "/" .. Duel.GetLocationCount(0, LOCATION_PZONE))
      Debug.Message("pzone right open " .. tostring(Duel.CheckLocation(0, LOCATION_PZONE, 1)))
      `,
      "pendulum-zones-closed.lua",
    );

    expect(closed.ok, closed.error).toBe(true);
    expect(host.messages).toContain("pzone closed false/0");
    expect(host.messages).toContain("pzone right open false");
  });

  it("lets Lua scripts inspect, confirm, and move deck-top groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck A", kind: "monster" },
      { code: "200", name: "Deck B", kind: "monster" },
      { code: "300", name: "Deck C", kind: "monster" },
      { code: "400", name: "Deck D", kind: "monster" },
    ];
    const session = createDuel({ seed: 11, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const expectedDeck = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((a, b) => a.sequence - b.sequence)
      .map((card) => card.code);
    const expectedTop = expectedDeck.slice(0, 2);
    const expectedBottom = expectedDeck.slice(-2);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.DisableShuffleCheck()
      local top = Duel.GetDecktopGroup(0, 2)
      local bottom = Duel.GetDeckbottomGroup(0, 2)
      Debug.Message("top count " .. top:GetCount())
      Debug.Message("bottom count " .. bottom:GetCount())
      local first = top:GetNext()
      local second = top:GetNext()
      local first_bottom = bottom:GetNext()
      local second_bottom = bottom:GetNext()
      Debug.Message("first top " .. first:GetCode())
      Debug.Message("second top " .. second:GetCode())
      Debug.Message("first bottom " .. first_bottom:GetCode())
      Debug.Message("second bottom " .. second_bottom:GetCode())
      Duel.SortDecktop(0, 0, 2)
      Debug.Message("sort top operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Duel.SortDeckbottom(0, 0, 2)
      Debug.Message("sort bottom operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Duel.ConfirmCards(1, top)
      Duel.ConfirmDecktop(0, 3)
      Debug.Message("sent top " .. Duel.SendtoHand(top, 0, REASON_EFFECT))
      Duel.ShuffleDeck(0)
      `,
      "deck-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("top count 2");
    expect(host.messages).toContain("bottom count 2");
    expect(host.messages).toContain(`first top ${expectedTop[0]}`);
    expect(host.messages).toContain(`second top ${expectedTop[1]}`);
    expect(host.messages).toContain(`first bottom ${expectedBottom[0]}`);
    expect(host.messages).toContain(`second bottom ${expectedBottom[1]}`);
    expect(host.messages).toContain(`sort top operated 2/${expectedTop[0]}`);
    expect(host.messages).toContain(`sort bottom operated 2/${expectedDeck[expectedDeck.length - 2]}`);
    expect(host.messages).toContain(`confirmed 1: ${expectedTop.join(",")}`);
    expect(host.messages).toContain(`confirmed decktop 0: ${expectedDeck.slice(0, 3).join(",")}`);
    expect(host.messages).toContain("sent top 2");
    expect(session.state.shuffleCheckDisabled).toBe(true);
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && expectedTop.includes(card.code))).toHaveLength(2);
  });

  it("lets Lua scripts shuffle a player's hand", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand A", kind: "monster" },
      { code: "200", name: "Hand B", kind: "monster" },
      { code: "300", name: "Hand C", kind: "monster" },
      { code: "400", name: "Hand D", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const before = handCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ShuffleHand(0)
      Debug.Message("hand shuffled")
      `,
      "shuffle-hand.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hand shuffled");
    const after = handCodes(session, 0);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  it("lets Lua scripts goat-confirm hand and deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Goat Hand A", kind: "monster" },
      { code: "200", name: "Goat Hand B", kind: "monster" },
      { code: "300", name: "Goat Deck A", kind: "monster" },
      { code: "400", name: "Goat Deck B", kind: "monster" },
    ];
    const session = createDuel({ seed: 13, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const beforeHand = handCodes(session, 0);
    const beforeDeck = deckCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.GoatConfirm(0, LOCATION_HAND + LOCATION_DECK)
      Debug.Message("goat confirm done")
      `,
      "goat-confirm.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`confirmed 0: ${beforeDeck.join(",")}`);
    expect(host.messages).toContain(`confirmed 1: ${beforeHand.join(",")}`);
    expect(host.messages).toContain("goat confirm done");
    expect([...handCodes(session, 0)].sort()).toEqual([...beforeHand].sort());
    expect([...deckCodes(session, 0)].sort()).toEqual([...beforeDeck].sort());
  });

  it("lets Lua scripts shuffle a player's extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "Extra A", kind: "extra" },
      { code: "910", name: "Extra B", kind: "extra" },
      { code: "920", name: "Extra C", kind: "extra" },
      { code: "930", name: "Extra D", kind: "extra" },
      { code: "940", name: "Extra E", kind: "extra" },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [], extra: ["900", "910", "920", "930", "940"] },
      1: { main: [] },
    });
    startDuel(session);
    const before = extraCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ShuffleExtra(0)
      Debug.Message("extra shuffled")
      `,
      "shuffle-extra.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("extra shuffled");
    const after = extraCodes(session, 0);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  it("lets Lua scripts confirm and read the extra deck top group", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "Extra Top A", kind: "extra" },
      { code: "910", name: "Extra Top B", kind: "extra" },
      { code: "920", name: "Extra Top C", kind: "extra" },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [], extra: ["900", "910", "920"] },
      1: { main: [] },
    });
    startDuel(session);
    const expectedTop = extraCodes(session, 0).slice(0, 2);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ConfirmExtratop(0,2)
      local g=Duel.GetExtraTopGroup(0,2)
      Debug.Message("extra top group " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
      `,
      "confirm-extra-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`confirmed extratop 0: ${expectedTop.join(",")}`);
    expect(host.messages).toContain(`extra top group 2/${expectedTop[0]}`);
  });

  it("lets Lua scripts create and summon tokens", () => {
    const cards: DuelCardData[] = [{ code: "123456", name: "Generated Token", kind: "monster", attack: 500, defense: 500 }];
    const session = createDuel({ seed: 13, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local token = Duel.CreateToken(0, 123456)
      Debug.Message("token code " .. token:GetCode())
      Debug.Message("token attack " .. token:GetAttack())
      Debug.Message("token hand " .. tostring(token:IsLocation(LOCATION_HAND)) .. "/" .. tostring(token:IsDestination(LOCATION_HAND)) .. "/" .. tostring(token:IsDestination(LOCATION_MZONE)))
      Debug.Message("token summon " .. Duel.SpecialSummon(token, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("token mzone destination " .. tostring(token:IsDestination(LOCATION_MZONE)))
      Debug.Message("token faceup " .. tostring(token:IsFaceup()))
      `,
      "create-token.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("token code 123456");
    expect(host.messages).toContain("token attack 500");
    expect(host.messages).toContain("token hand true/true/false");
    expect(host.messages).toContain("token summon 1");
    expect(host.messages).toContain("token mzone destination true");
    expect(host.messages).toContain("token faceup true");
    expect(session.state.cards.find((card) => card.code === "123456")).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
  });

  it("lets Lua scripts query leave-field destinations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leaving Monster", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Hand Card", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 181, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const leaving = session.state.cards.find((card) => card.code === "100")!;
    moveDuelCard(session.state, leaving.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local leaving=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("destination " .. leaving:GetDestination() .. "/" .. tostring(leaving:IsDestination(LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsDestination(LOCATION_HAND)))
      Debug.Message("leave field dest " .. leaving:GetLeaveFieldDest() .. "/" .. tostring(leaving:IsLeaveFieldDest(LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsLeaveFieldDest(LOCATION_HAND)))
      Debug.Message("hand destination " .. hand:GetDestination())
      Debug.Message("hand leave field dest " .. hand:GetLeaveFieldDest() .. "/" .. tostring(hand:IsLeaveFieldDest(LOCATION_HAND)))
      `,
      "leave-field-destination.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("destination 16/true/false");
    expect(host.messages).toContain("leave field dest 16/true/false");
    expect(host.messages).toContain("hand destination 0");
    expect(host.messages).toContain("hand leave field dest 0/false");
  });

  it("lets Lua scripts draw and search deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw A", kind: "monster" },
      { code: "200", name: "Draw B", kind: "monster" },
      { code: "300", name: "Search Target", kind: "monster" },
      { code: "400", name: "Draw C", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const deckOrder = session.state.cards.filter((card) => card.controller === 0 && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
    const drawnCodes = deckOrder.slice(0, 2).map((card) => card.code);
    const searchCode = deckOrder.slice(2).find((card) => card.code === "300")?.code ?? deckOrder[2]!.code;
    const discardedCode = deckOrder.slice(2).find((card) => card.code !== searchCode)!.code;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can draw two " .. tostring(Duel.IsPlayerCanDraw(0, 2)))
      Debug.Message("can draw five " .. tostring(Duel.IsPlayerCanDraw(0, 5)))
      Debug.Message("drawn " .. Duel.Draw(0, 2, REASON_EFFECT))
      Debug.Message("draw operated " .. Duel.GetOperatedGroup():GetCount())
      local searched = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${searchCode}), 0, LOCATION_DECK, 0, 1, 1, nil)
      local searched_card = searched:GetFirst()
      Debug.Message("can grave searched " .. tostring(Duel.IsPlayerCanSendtoGrave(0, searched_card)))
      Debug.Message("can hand searched " .. tostring(Duel.IsPlayerCanSendtoHand(0, searched_card)))
      Debug.Message("can deck searched " .. tostring(Duel.IsPlayerCanSendtoDeck(0, searched_card)))
      Debug.Message("can remove searched " .. tostring(Duel.IsPlayerCanRemove(0, searched_card)))
      Debug.Message("can extra searched " .. tostring(Duel.IsPlayerCanSendtoExtra(0, searched_card)))
      Debug.Message("can special summon " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0)))
      Debug.Message("searched " .. Duel.SendtoHand(searched, 0, REASON_EFFECT))
      Debug.Message("search operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can discard one " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 1)))
      Debug.Message("can discard two " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 2)))
      Debug.Message("can discard cost one " .. tostring(Duel.IsPlayerCanDiscardDeckAsCost(0, 1)))
      Debug.Message("can discard cost two " .. tostring(Duel.IsPlayerCanDiscardDeckAsCost(0, 2)))
      Debug.Message("discarded " .. Duel.DiscardDeck(0, 2, REASON_EFFECT))
      Debug.Message("discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can hand discard three " .. tostring(Duel.IsPlayerCanDiscardHand(0, 3)))
      Debug.Message("can hand discard four " .. tostring(Duel.IsPlayerCanDiscardHand(0, 4)))
      Debug.Message("hand discarded " .. Duel.DiscardHand(0, aux.FilterBoolFunction(Card.IsCode, ${drawnCodes[0]}), 1, 1, REASON_EFFECT))
      Debug.Message("hand discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "draw-search.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can draw two true");
    expect(host.messages).toContain("can draw five false");
    expect(host.messages).toContain("drawn 2");
    expect(host.messages).toContain("draw operated 2");
    expect(host.messages).toContain("can grave searched true");
    expect(host.messages).toContain("can hand searched true");
    expect(host.messages).toContain("can deck searched false");
    expect(host.messages).toContain("can remove searched true");
    expect(host.messages).toContain("can extra searched false");
    expect(host.messages).toContain("can special summon true");
    expect(host.messages).toContain("searched 1");
    expect(host.messages).toContain(`search operated ${searchCode}`);
    expect(host.messages).toContain("can discard one true");
    expect(host.messages).toContain("can discard two false");
    expect(host.messages).toContain("can discard cost one true");
    expect(host.messages).toContain("can discard cost two false");
    expect(host.messages).toContain("discarded 1");
    expect(host.messages).toContain(`discard operated 1/${discardedCode}`);
    expect(host.messages).toContain("can hand discard three true");
    expect(host.messages).toContain("can hand discard four false");
    expect(host.messages).toContain("hand discarded 1");
    expect(host.messages).toContain(`hand discard operated 1/${drawnCodes[0]}`);
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && drawnCodes.includes(card.code))).toHaveLength(1);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === drawnCodes[0])?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === searchCode)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === discardedCode)?.location).toBe("graveyard");
  });

  it("lets Lua scripts query turn draw counts", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Draw Count Card", kind: "monster" }];
    const session = createDuel({ seed: 71, startingHandSize: 0, drawPerTurn: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("draw count self " .. Duel.GetDrawCount(0))
      Debug.Message("draw count opponent " .. Duel.GetDrawCount(1))
      Debug.Message("draw count default " .. Duel.GetDrawCount())
      `,
      "draw-count.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("draw count self 2");
    expect(host.messages).toContain("draw count opponent 2");
    expect(host.messages).toContain("draw count default 2");
  });

  it("lets Lua scripts query active field spell environments", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Environment", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 73, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const field = session.state.cards.find((card) => card.code === "100");
    const spell = session.state.cards.find((card) => card.code === "200");
    expect(field).toBeDefined();
    expect(spell).toBeDefined();
    moveDuelCard(session.state, field!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("environment field " .. tostring(Duel.IsEnvironment(100)))
      Debug.Message("environment player " .. tostring(Duel.IsEnvironment(100, 0)))
      Debug.Message("environment fzone " .. tostring(Duel.IsEnvironment(100, PLAYER_ALL, LOCATION_FZONE)))
      Debug.Message("environment normal spell " .. tostring(Duel.IsEnvironment(200)))
      Debug.Message("environment missing " .. tostring(Duel.IsEnvironment(300)))
      Debug.Message("environment code " .. Duel.GetEnvironment(0, LOCATION_FZONE))
      `,
      "field-environment.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("environment field true");
    expect(host.messages).toContain("environment player true");
    expect(host.messages).toContain("environment fzone true");
    expect(host.messages).toContain("environment normal spell false");
    expect(host.messages).toContain("environment missing false");
    expect(host.messages).toContain("environment code 100");
  });

  it("lets Lua scripts activate and replace field spells", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Old Field", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "New Field", kind: "spell", typeFlags: 0x80002 },
      { code: "300", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 74, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const oldField = session.state.cards.find((card) => card.code === "100");
    expect(oldField).toBeDefined();
    moveDuelCard(session.state, oldField!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("activate normal field " .. tostring(Duel.ActivateFieldSpell(normal,nil,0)))
      Debug.Message("activate field spell " .. tostring(Duel.ActivateFieldSpell(field,nil,0)))
      Debug.Message("activate operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("activate environment " .. tostring(Duel.IsEnvironment(200, 0, LOCATION_FZONE)))
      `,
      "activate-field-spell.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("activate normal field false");
    expect(host.messages).toContain("activate field spell true");
    expect(host.messages).toContain("activate operated 1/200");
    expect(host.messages).toContain("activate environment true");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "hand" });
  });

  it("lets Lua scripts query field groups across both players and locations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Grave", kind: "monster" },
      { code: "200", name: "Self Banished", kind: "monster" },
      { code: "300", name: "Opponent Grave", kind: "monster" },
      { code: "400", name: "Opponent Deck", kind: "monster" },
    ];
    const session = createDuel({ seed: 13, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "100")!.uid, "graveyard", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "200")!.uid, "banished", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "300")!.uid, "graveyard", 1);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "400")!.uid, "deck", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mixed = Duel.GetFieldGroup(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK)
      Debug.Message("mixed count " .. mixed:GetCount())
      Debug.Message("mixed tostring " .. tostring(mixed) .. "/" .. Group.__tostring(mixed))
      local iter_codes={}
      for tc in Group.Iter(mixed:Clone()) do
        iter_codes[#iter_codes+1]=tc:GetCode()
      end
      Debug.Message("group new iter " .. Group.NewGroup():GetCount() .. "/" .. table.concat(iter_codes,","))
      Debug.Message("field count " .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK))
      Debug.Message("field rush count " .. Duel.GetFieldGroupCountRush(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK))
      Debug.Message("banished count " .. Duel.GetMatchingGroupCount(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil))
      Debug.Message("banished rush count " .. Duel.GetMatchingGroupCountRush(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil))
      Debug.Message("banished rush group " .. Duel.GetMatchingGroupRush(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil):GetCount())
      local first = mixed:GetNext()
      local second = mixed:GetNext()
      local third = mixed:GetNext()
      local fourth = mixed:GetNext()
      local same_common, same_value = Group.FromCards(first, third):CheckSameProperty(function(c)
        if c:IsCode(100) then return 0x3 end
        return 0x2
      end)
      local same_none, same_none_value = Group.FromCards(first, second):CheckSameProperty(function(c)
        if c:IsCode(100) then return 0x1 end
        return 0x2
      end)
      Debug.Message("group same property " .. tostring(same_common) .. "/" .. same_value .. "/" .. tostring(same_none) .. "/" .. same_none_value)
      Debug.Message("group different property " .. tostring(Group.FromCards(first, second):CheckDifferentProperty(Card.GetCode)) .. "/" .. tostring(Group.FromCards(first, second):CheckDifferentProperty(function(c) return 1 end)))
      Debug.Message("group different property multi " .. tostring(Group.FromCards(first, second):CheckDifferentProperty(function(c)
        if c:IsCode(100) then return 1,2 end
        return 2,3
      end)))
      Debug.Message("group different binary " .. tostring(Group.FromCards(first, second, third):CheckDifferentPropertyBinary(function(c)
        if c:IsCode(100) then return 0x1 end
        if c:IsCode(200) then return 0x3 end
        return 0x4
      end)) .. "/" .. tostring(Group.FromCards(first, second):CheckDifferentPropertyBinary(function(c) return 0x1 end)))
      Debug.Message("mixed codes " .. first:GetCode() .. "," .. second:GetCode() .. "," .. third:GetCode() .. "," .. fourth:GetCode())
      local own_grave = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      local opponent_deck = Duel.GetFieldCard(1, LOCATION_DECK, 0)
      local empty = Duel.GetFieldCard(0, LOCATION_GRAVE, 3)
      Debug.Message("field card codes " .. own_grave:GetCode() .. "/" .. opponent_deck:GetCode() .. "/" .. tostring(empty == nil))
      local function match(c, code)
        return c:IsCode(code)
      end
      local first_match = Duel.GetFirstMatchingCard(match, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil, 300)
      Debug.Message("first matching card " .. first_match:GetCode())
      Debug.Message("equal function code " .. Duel.GetMatchingGroupCount(aux.FilterEqualFunction(Card.GetCode, 300), 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil))
      Debug.Message("equal function set " .. Duel.GetMatchingGroupCount(aux.FilterEqualFunction(Card.IsCode, true, 300), 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil))
      local excluded = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(300) end, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil)
      local group_excluded = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded)
      Debug.Message("group excluded count " .. group_excluded:GetCount())
      Debug.Message("group excluded matching count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded))
      Debug.Message("matching target alias count " .. Duel.GetMatchingTargetCount(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded))
      Debug.Message("matching target alias group " .. Duel.GetMatchingTarget(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded):GetCount())
      Debug.Message("group excluded exists " .. tostring(Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, excluded)))
      Debug.Message("group excluded first " .. Duel.GetFirstMatchingCard(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded):GetCode())
      Debug.Message("group excluded selected " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, 3, excluded):GetCount())
      Debug.Message("group excluded selected too few " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 3, 3, excluded):GetCount())
      Debug.Message("group excluded selected unbounded " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, 0, excluded):GetCount())
      local excluded_card = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("card excluded group " .. Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded_card):GetCount())
      Debug.Message("card excluded count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded_card))
      Debug.Message("card excluded exists " .. tostring(Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, excluded_card)))
      Debug.Message("card excluded first " .. Duel.GetFirstMatchingCard(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded_card):GetCode())
      Debug.Message("card excluded selected " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, 4, excluded_card):GetCount())
      Debug.Message("onfield count " .. Duel.GetFieldGroupCount(0, LOCATION_ONFIELD, LOCATION_ONFIELD))
      Debug.Message("hand field count " .. Duel.GetFieldGroup(0, LOCATION_HAND + LOCATION_GRAVE, LOCATION_DECK):GetCount())
      Debug.Message("empty field count " .. Duel.GetFieldGroup(0, 0, 0):GetCount() .. "/" .. Duel.GetFieldGroupCount(0, 0, 0))
      `,
      "field-groups.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("mixed count 4");
    expect(host.messages).toContain('mixed tostring Group: { "size": 4 }/Group: { "size": 4 }');
    expect(host.messages).toContain("group new iter 0/100,200,300,400");
    expect(host.messages).toContain("group same property true/2/false/0");
    expect(host.messages).toContain("group different property true/false");
    expect(host.messages).toContain("group different property multi true");
    expect(host.messages).toContain("group different binary true/false");
    expect(host.messages).toContain("field count 4");
    expect(host.messages).toContain("field rush count 4");
    expect(host.messages).toContain("banished count 1");
    expect(host.messages).toContain("banished rush count 1");
    expect(host.messages).toContain("banished rush group 1");
    expect(host.messages).toContain("mixed codes 100,200,300,400");
    expect(host.messages).toContain("field card codes 100/400/true");
    expect(host.messages).toContain("first matching card 300");
    expect(host.messages).toContain("equal function code 1");
    expect(host.messages).toContain("equal function set 1");
    expect(host.messages).toContain("group excluded count 2");
    expect(host.messages).toContain("group excluded matching count 2");
    expect(host.messages).toContain("matching target alias count 2");
    expect(host.messages).toContain("matching target alias group 2");
    expect(host.messages).toContain("group excluded exists false");
    expect(host.messages).toContain("group excluded first 200");
    expect(host.messages).toContain("group excluded selected 2");
    expect(host.messages).toContain("group excluded selected too few 0");
    expect(host.messages).toContain("group excluded selected unbounded 2");
    expect(host.messages).toContain("card excluded group 3");
    expect(host.messages).toContain("card excluded count 3");
    expect(host.messages).toContain("card excluded exists false");
    expect(host.messages).toContain("card excluded first 200");
    expect(host.messages).toContain("card excluded selected 3");
    expect(host.messages).toContain("onfield count 0");
    expect(host.messages).toContain("hand field count 2");
    expect(host.messages).toContain("empty field count 0/0");
  });

  it("lets Lua scripts read card type, stats, race, and attribute", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "900", name: "Stat Monster", kind: "monster", typeFlags: 0x21, attack: 2500, defense: 2100, level: 7, race: 0x2, attribute: 0x20, setcodes: [0x123], listedNames: ["700"], fitMonster: ["800"] },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
      { code: "201", name: "Fixture Equip Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "202", name: "Fixture Trap Monster", kind: "trap", typeFlags: 0x105, level: 4, race: 0x2, attribute: 0x20 },
      { code: "203", name: "Fixture Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: "204", name: "Fixture Quick-Play Spell", kind: "spell", typeFlags: 0x10002 },
      { code: "300", name: "Rank Fixture", kind: "monster", typeFlags: 0x800001, attack: 1800, defense: 1200, level: 4 },
      { code: "301", name: "Zero Rank Fixture", kind: "monster", typeFlags: 0x800001, attack: 1000, defense: 1000, level: 0 },
      { code: "400", name: "Link Fixture", kind: "monster", typeFlags: 0x4000001, attack: 1500, level: 2, linkMarkers: 0x5, setcodes: [0x564] },
      { code: "500", name: "Infinity Alias", kind: "monster", alias: "1378" },
      { code: "600", name: "Multi Attribute", kind: "monster", attribute: 0x30 },
      { code: "700", name: "Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 6, ritualMaterials: ["100"], setcodes: [0x456] },
      { code: "800", name: "Normal Fixture", kind: "monster", typeFlags: 0x11, level: 4 },
      { code: "801", name: "Synchro Fixture", kind: "extra", typeFlags: 0x2001, level: 7 },
      { code: "901", name: "Pendulum Fixture", kind: "monster", typeFlags: 0x1000021, level: 4, leftScale: 3, rightScale: 8 },
      { code: "902", name: "Material Listing Fusion", kind: "extra", fusionMaterials: ["100", "800"], materialSetcodes: [0x3000 | 0x123] },
      { code: "903", name: "Unknown Stat Fixture", kind: "monster", typeFlags: 0x21, attack: -2, defense: -2, level: 10 },
      { code: "904", name: "Spirit Fixture", kind: "monster", typeFlags: 0x200021, level: 4 },
      { code: "905", name: "Plus Fixture", kind: "monster", typeFlags: 0x20000001, level: 4 },
      { code: "906", name: "Minus Fixture", kind: "monster", typeFlags: 0x40000001, level: 4 },
      { code: "907", name: "Plus Minus Fixture", kind: "monster", typeFlags: 0x60000001, level: 4 },
      { code: "908", name: "Zero Level Fixture", kind: "monster", typeFlags: 0x1, level: 0 },
    ];
    const session = createDuel({ seed: 14, startingHandSize: 20, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201", "202", "203", "204", "300", "301", "400", "500", "600", "700", "800", "901", "903", "904", "905", "906", "907", "908"], extra: ["801", "902"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monsters = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local c = monsters:GetFirst()
      Debug.Message("type " .. c:GetType())
      Debug.Message("exact type " .. tostring(c:IsExactType(TYPE_MONSTER|TYPE_EFFECT)) .. "/" .. tostring(c:IsExactType(TYPE_MONSTER)))
      Debug.Message("stats " .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. c:GetLevel())
      Debug.Message("text stats " .. c:GetTextAttack() .. "/" .. c:GetTextDefense() .. "/" .. tostring(c:IsTextAttack(2500)) .. "/" .. tostring(c:IsTextDefense(2100)))
      Debug.Message("attack update " .. c:UpdateAttack(300, RESETS_STANDARD_PHASE_END) .. "/" .. c:GetAttack() .. "/" .. c:GetBaseAttack() .. "/" .. tostring(c:IsAttack(2800)) .. "/" .. tostring(c:IsTextAttack(2800)))
      Debug.Message("defense update " .. c:UpdateDefense(-400, RESETS_STANDARD_PHASE_END) .. "/" .. c:GetDefense() .. "/" .. c:GetBaseDefense() .. "/" .. tostring(c:IsDefense(1700)) .. "/" .. tostring(c:IsTextDefense(1700)))
      Debug.Message("stat predicates " .. tostring(c:IsAttack(2500)) .. "/" .. tostring(c:IsBaseAttack(2500)) .. "/" .. tostring(c:IsDefense(2100)) .. "/" .. tostring(c:IsBaseDefense(2100)) .. "/" .. tostring(c:IsLevel(7)) .. "/" .. tostring(c:IsLevelBetween(8,6)) .. "/" .. tostring(c:IsLevelBetween(1,6)))
      Debug.Message("stat varargs " .. tostring(c:IsAttack(2500,2800)) .. "/" .. tostring(c:IsAttack(2500,2600)) .. "/" .. tostring(c:IsBaseAttack(2400,2500)) .. "/" .. tostring(c:IsDefense(2100,1700)) .. "/" .. tostring(c:IsBaseDefense(1700,2100)) .. "/" .. tostring(c:IsTextDefense(2100,1700)) .. "/" .. tostring(c:IsLevel(6,7)))
      Debug.Message("stat comparisons " .. tostring(c:IsAttackAbove(2400)) .. "/" .. tostring(c:IsAttackBelow(2600)) .. "/" .. tostring(c:IsDefenseAbove(2200)) .. "/" .. tostring(c:IsDefenseBelow(2200)) .. "/" .. tostring(c:IsLevelAbove(6)) .. "/" .. tostring(c:IsLevelBelow(6)))
      Debug.Message("original stat comparisons " .. tostring(c:IsOriginalAttack(2500,2400)) .. "/" .. tostring(c:IsOriginalAttackAbove(2400)) .. "/" .. tostring(c:IsOriginalAttackBelow(2600)) .. "/" .. tostring(c:IsOriginalDefense(2100,1700)) .. "/" .. tostring(c:IsOriginalDefenseAbove(2200)) .. "/" .. tostring(c:IsOriginalDefenseBelow(2200)) .. "/" .. tostring(c:IsOriginalLevel(6,7)) .. "/" .. tostring(c:IsOriginalLevelAbove(6)) .. "/" .. tostring(c:IsOriginalLevelBelow(6)))
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsCode(900,100)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(900,100)) .. "/" .. tostring(c:IsOriginalCode(100)))
      Debug.Message("not code checks " .. tostring(c:IsNotCode(900)) .. "/" .. tostring(c:IsNotCode(900,100)) .. "/" .. tostring(c:IsNotCode(901)))
      Debug.Message("code rule checks " .. c:GetOriginalCodeRule() .. "/" .. tostring(c:IsOriginalCodeRule(900)) .. "/" .. tostring(c:IsOriginalCodeRule(900,100)) .. "/" .. tostring(c:IsOriginalCodeRule(100)))
      Debug.Message("set checks " .. tostring(c:IsSetCard(0x123)) .. "/" .. tostring(c:IsSetCard({0x456,0x123})) .. "/" .. tostring(c:IsOriginalSetCard(0x123)) .. "/" .. tostring(c:IsOriginalSetCard({0x456,0x123})) .. "/" .. tostring(c:IsOriginalSetCard(0x456)) .. "/" .. tostring(c:IsNotSetCard(0x123)) .. "/" .. tostring(c:IsNotSetCard({0x123,0x456})) .. "/" .. tostring(c:IsNotSetCard(0x456)))
      local property_filter=aux.PropertyTableFilter(Card.GetSetCard,0x123,0x456)
      Debug.Message("listed checks " .. tostring(c:ListsCode(700)) .. "/" .. tostring(c:ListsCode(800)) .. "/" .. tostring(c:ListsCode(900)) .. "/" .. tostring(c:ListsCode(600,700)) .. "/" .. tostring(c:ListsCode({600,700})) .. "/" .. tostring(c:ListsCodeWithArchetype(0x456)) .. "/" .. tostring(c:ListsCodeWithArchetype({0x789,0x456})) .. "/" .. tostring(c:ListsCodeWithArchetype(0x789)))
      local infinity = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("infinity checks " .. tostring(infinity:IsInfinity()) .. "/" .. tostring(c:IsInfinity()))
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local zero_rank = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local link = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local synchro = Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 801), 0, LOCATION_EXTRA, 0, nil):GetFirst()
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spirit = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 904), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material_fusion = Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 902), 0, LOCATION_EXTRA, 0, nil):GetFirst()
      local unknown_stats = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 903), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local plus = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 905), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local minus = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 906), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local plus_minus = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 907), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      c:GetMetatable().listed_series={0x123,0x456}
      c:GetMetatable().listed_card_types={0x200000,0x400000}
      c:GetMetatable().counter_list={0x10,0x20}
      c:GetMetatable().counter_place_list={0x30,0x40}
      local property_match=property_filter(c)
      local property_miss=property_filter(normal)
      Debug.Message("property table filter " .. tostring(property_match) .. "/" .. tostring(property_miss))
      Debug.Message("unknown text stats " .. unknown_stats:GetTextAttack() .. "/" .. unknown_stats:GetTextDefense() .. "/" .. tostring(Card.IsTextAttack(unknown_stats,-2)) .. "/" .. tostring(Card.IsTextDefense(unknown_stats,-2)))
      Debug.Message("material listed checks " .. tostring(material_fusion:ListsCodeAsMaterial(100)) .. "/" .. tostring(material_fusion:ListsCodeAsMaterial(700,800)) .. "/" .. tostring(material_fusion:ListsCodeAsMaterial({700,800})) .. "/" .. tostring(material_fusion:ListsCodeAsMaterial(300)) .. "/" .. tostring(ritual:ListsCodeAsMaterial(100)))
      Debug.Message("material set listed checks " .. tostring(material_fusion:ListsArchetypeAsMaterial(0x123)) .. "/" .. tostring(material_fusion:ListsArchetypeAsMaterial({0x223,0x123})) .. "/" .. tostring(material_fusion:ListsArchetypeAsMaterial(0x223)) .. "/" .. tostring(ritual:ListsArchetypeAsMaterial(0x123)))
      Debug.Message("listed archetype type checks " .. tostring(c:ListsArchetype(0x123)) .. "/" .. tostring(c:ListsArchetype(0x789)) .. "/" .. tostring(c:ListsCardType(0x200000)) .. "/" .. tostring(c:ListsCardType(0x800000)) .. "/" .. tostring(ritual:ListsCardType(0x200000)))
      Debug.Message("listed counter checks " .. tostring(c:ListsCounter(0x10)) .. "/" .. tostring(c:ListsCounter(0x30)) .. "/" .. tostring(c:PlacesCounter(0x30)) .. "/" .. tostring(c:PlacesCounter(0x10)) .. "/" .. tostring(ritual:ListsCounter(0x10)))
      Debug.Message("original predicates " .. tostring(c:IsOriginalType(TYPE_EFFECT)) .. "/" .. tostring(c:IsOriginalLevel(7)))
      Debug.Message("not type " .. tostring(c:IsNotType(TYPE_EFFECT)) .. "/" .. tostring(c:IsNotType(TYPE_SPELL)))
      Debug.Message("not original type " .. tostring(c:IsNotOriginalType(TYPE_EFFECT)) .. "/" .. tostring(c:IsNotOriginalType(TYPE_SPELL)))
      Debug.Message("named type predicates " .. tostring(ritual:IsRitualMonster()) .. "/" .. tostring(c:IsRitualMonster()) .. "/" .. tostring(synchro:IsSynchroMonster()) .. "/" .. tostring(c:IsSynchroMonster()) .. "/" .. tostring(xyz:IsXyzMonster()) .. "/" .. tostring(c:IsXyzMonster()) .. "/" .. tostring(pendulum:IsPendulumMonster()) .. "/" .. tostring(c:IsPendulumMonster()) .. "/" .. tostring(normal:IsNonEffectMonster()) .. "/" .. tostring(c:IsNonEffectMonster()) .. "/" .. tostring(c:IsEffectMonster()) .. "/" .. tostring(normal:IsEffectMonster()) .. "/" .. tostring(c:IsForbidden()))
      Debug.Message("rank " .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:HasRank()) .. "/" .. tostring(normal:HasRank()) .. "/" .. tostring(xyz:IsRank(4)) .. "/" .. tostring(xyz:IsOriginalRank(4)) .. "/" .. zero_rank:GetRank() .. "/" .. tostring(zero_rank:HasRank()))
      Debug.Message("rank varargs " .. tostring(xyz:IsRank(3,4)) .. "/" .. tostring(xyz:IsRank(2,3)) .. "/" .. tostring(xyz:IsOriginalRank(3,4)))
      Debug.Message("rank level gates " .. tostring(xyz:IsOriginalLevel(4)) .. "/" .. tostring(normal:IsOriginalRank(0)))
      Debug.Message("spirit predicate " .. tostring(spirit:IsSpirit()) .. "/" .. tostring(c:IsSpirit()))
      Debug.Message("plus minus predicate " .. tostring(plus:IsPlusOrMinus()) .. "/" .. tostring(minus:IsPlusOrMinus()) .. "/" .. tostring(plus_minus:IsPlusOrMinus()) .. "/" .. tostring(c:IsPlusOrMinus()))
      Debug.Message("rank comparisons " .. tostring(xyz:IsRankAbove(3)) .. "/" .. tostring(xyz:IsRankBelow(3)) .. "/" .. tostring(xyz:IsOriginalRankAbove(4)) .. "/" .. tostring(xyz:IsOriginalRankBelow(4)))
      Debug.Message("rank update " .. xyz:UpdateRank(-10, RESETS_STANDARD_PHASE_END) .. "/" .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:IsRank(1)) .. "/" .. tostring(xyz:IsRankBelow(2)))
      Debug.Message("link " .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. link:GetLinkMarker() .. "/" .. tostring(link:IsLink(2)) .. "/" .. tostring(link:IsOriginalLink(2)) .. "/" .. tostring(link:IsLinkMonster()) .. "/" .. tostring(c:IsLinkMonster()) .. "/" .. tostring(link:IsLineMonster()) .. "/" .. tostring(c:IsLineMonster()))
      Debug.Message("link varargs " .. tostring(link:IsLink(1,2)) .. "/" .. tostring(link:IsLink(3,4)) .. "/" .. tostring(link:IsOriginalLink(1,2)))
      Debug.Message("link stat gates " .. tostring(link:IsDefense(0)) .. "/" .. tostring(link:IsBaseDefense(0)) .. "/" .. tostring(link:IsTextDefense(0)) .. "/" .. tostring(link:IsOriginalDefense(0)) .. "/" .. tostring(link:IsLevel(2)) .. "/" .. tostring(link:IsLevelBelow(3)))
      Debug.Message("link comparisons " .. tostring(link:IsLinkAbove(2)) .. "/" .. tostring(link:IsLinkBelow(1)) .. "/" .. tostring(link:IsOriginalLinkAbove(3)) .. "/" .. tostring(link:IsOriginalLinkBelow(2)))
      Debug.Message("link update " .. link:UpdateLink(3, RESETS_STANDARD_PHASE_END) .. "/" .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. tostring(link:IsLink(5)) .. "/" .. tostring(link:IsLinkAbove(5)))
      local fixed_ritual=Effect.CreateEffect(c)
      fixed_ritual:SetType(EFFECT_TYPE_SINGLE)
      fixed_ritual:SetCode(EFFECT_RITUAL_LEVEL)
      fixed_ritual:SetValue(5)
      c:RegisterEffect(fixed_ritual)
      Debug.Message("ritual fixed level " .. c:GetRitualLevel())
      local function_ritual=Effect.CreateEffect(link)
      function_ritual:SetType(EFFECT_TYPE_SINGLE)
      function_ritual:SetCode(EFFECT_RITUAL_LEVEL)
      function_ritual:SetValue(function(e,mat,rc) return mat:GetLevel()+rc:GetLevel() end)
      link:RegisterEffect(function_ritual)
      Debug.Message("ritual function level " .. link:GetRitualLevel(c))
      aux.RitualSummoningLevel=7
      function_ritual:SetValue(function(e,mat,rc) return aux.RitualSummoningLevel or 0 end)
      Debug.Message("ritual summoning level " .. link:GetRitualLevel(c))
      aux.RitualSummoningLevel=nil
      local fixed_synchro=Effect.CreateEffect(c)
      fixed_synchro:SetType(EFFECT_TYPE_SINGLE)
      fixed_synchro:SetCode(EFFECT_SYNCHRO_LEVEL)
      fixed_synchro:SetValue(5)
      c:RegisterEffect(fixed_synchro)
      local function_synchro=Effect.CreateEffect(normal)
      function_synchro:SetType(EFFECT_TYPE_SINGLE)
      function_synchro:SetCode(EFFECT_SYNCHRO_LEVEL)
      function_synchro:SetValue(function(e,sc) return sc:GetLevel()+1 end)
      normal:RegisterEffect(function_synchro)
      Debug.Message("synchro levels " .. xyz:GetSynchroLevel() .. "/" .. c:GetSynchroLevel() .. "/" .. normal:GetSynchroLevel(c))
      Debug.Message("level update " .. c:UpdateLevel(-20, RESETS_STANDARD_PHASE_END) .. "/" .. c:GetLevel() .. "/" .. c:GetOriginalLevel() .. "/" .. tostring(c:IsLevel(1)) .. "/" .. tostring(c:IsLevelBelow(2)))
      Debug.Message("scale hand " .. pendulum:GetScale() .. "/" .. pendulum:GetLeftScale() .. "/" .. pendulum:GetRightScale() .. "/" .. pendulum:GetOriginalLeftScale() .. "/" .. pendulum:GetOriginalRightScale() .. "/" .. tostring(pendulum:IsScale(3)) .. "/" .. tostring(pendulum:IsOddScale()) .. "/" .. tostring(pendulum:IsEvenScale()))
      Duel.MoveToField(pendulum,0,0,LOCATION_PZONE,POS_FACEUP,true,1)
      Debug.Message("scale pzone " .. pendulum:GetSequence() .. "/" .. pendulum:GetScale() .. "/" .. tostring(pendulum:IsOddScale()) .. "/" .. tostring(pendulum:IsEvenScale()))
      Debug.Message("scale update " .. pendulum:UpdateScale(-10, RESETS_STANDARD_PHASE_END) .. "/" .. pendulum:GetScale() .. "/" .. pendulum:GetLeftScale() .. "/" .. pendulum:GetRightScale() .. "/" .. pendulum:GetOriginalLeftScale() .. "/" .. pendulum:GetOriginalRightScale() .. "/" .. tostring(pendulum:IsScale(1)))
      Debug.Message("race " .. c:GetRace() .. " " .. tostring(c:IsRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsOriginalRace(RACE_SPELLCASTER)))
      Debug.Message("not race " .. tostring(c:IsNotRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsNotRace(RACE_DRAGON)))
      Debug.Message("not original race " .. tostring(c:IsNotOriginalRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsNotOriginalRace(RACE_DRAGON)))
      Debug.Message("attribute " .. c:GetAttribute() .. " " .. tostring(c:IsAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsOriginalAttribute(ATTRIBUTE_DARK)))
      c:AssumeProperty(ASSUME_CODE, 999)
      c:AssumeProperty(ASSUME_TYPE, TYPE_MONSTER|TYPE_TUNER)
      c:AssumeProperty(ASSUME_LEVEL, 3)
      c:AssumeProperty(ASSUME_RANK, 2)
      c:AssumeProperty(ASSUME_ATTRIBUTE, ATTRIBUTE_LIGHT)
      c:AssumeProperty(ASSUME_RACE, RACE_DRAGON)
      c:AssumeProperty(ASSUME_ATTACK, 1200)
      c:AssumeProperty(ASSUME_DEFENSE, 800)
      link:AssumeProperty(ASSUME_LINK, 4)
      link:AssumeProperty(ASSUME_LINKMARKER, LINK_MARKER_LEFT|LINK_MARKER_RIGHT)
      Debug.Message("assumed metadata " .. c:GetCode() .. "/" .. c:GetType() .. "/" .. c:GetLevel() .. "/" .. c:GetRank() .. "/" .. c:GetAttribute() .. "/" .. c:GetRace() .. "/" .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. link:GetLink() .. "/" .. link:GetLinkMarker())
      Debug.Message("assumed predicates " .. tostring(c:IsCode(999)) .. "/" .. tostring(c:IsOriginalCode(100)) .. "/" .. tostring(c:IsType(TYPE_TUNER)) .. "/" .. tostring(c:IsOriginalType(TYPE_EFFECT)) .. "/" .. tostring(c:IsRace(RACE_DRAGON)) .. "/" .. tostring(c:IsOriginalRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsAttribute(ATTRIBUTE_LIGHT)) .. "/" .. tostring(c:IsOriginalAttribute(ATTRIBUTE_DARK)))
      Duel.AssumeReset()
      Debug.Message("assumed reset " .. c:GetCode() .. "/" .. c:GetType() .. "/" .. c:GetLevel() .. "/" .. c:GetRank() .. "/" .. c:GetAttribute() .. "/" .. c:GetRace() .. "/" .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. link:GetLink() .. "/" .. link:GetLinkMarker())
      local multi = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("attribute except " .. tostring(c:IsAttributeExcept(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsAttributeExcept(ATTRIBUTE_LIGHT)) .. "/" .. tostring(multi:IsAttributeExcept(ATTRIBUTE_DARK)) .. "/" .. tostring(multi:IsAttributeExcept(ATTRIBUTE_DARK|ATTRIBUTE_LIGHT)))
      Debug.Message("different attribute " .. tostring(c:IsDifferentAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsDifferentAttribute(ATTRIBUTE_LIGHT)) .. "/" .. tostring(multi:IsDifferentAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(multi:IsDifferentAttribute(ATTRIBUTE_DARK|ATTRIBUTE_LIGHT)))
      local attrs={}
      for _,str in aux.GetAttributeStrings(ATTRIBUTE_LIGHT|ATTRIBUTE_DARK) do table.insert(attrs,str) end
      Debug.Message("attribute strings " .. table.concat(attrs,","))
      Debug.Message("not attribute " .. tostring(c:IsNotAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsNotAttribute(ATTRIBUTE_LIGHT)))
      Debug.Message("not original attribute " .. tostring(c:IsNotOriginalAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsNotOriginalAttribute(ATTRIBUTE_LIGHT)))
      Debug.Message("spell count " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, nil))
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trapmonster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 202), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fieldspell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 203), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local quickplay = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 204), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local zero_level = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 908), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("has level " .. tostring(c:HasLevel()) .. "/" .. tostring(xyz:HasLevel()) .. "/" .. tostring(link:HasLevel()) .. "/" .. tostring(spell:HasLevel()) .. "/" .. tostring(zero_level:HasLevel()))
      Debug.Message("main card types " .. c:GetMainCardType() .. "/" .. spell:GetMainCardType() .. "/" .. equip:GetMainCardType() .. "/" .. trapmonster:GetMainCardType())
      Debug.Message("spell trap checks " .. tostring(c:IsSpellTrap()) .. "/" .. tostring(spell:IsSpellTrap()) .. "/" .. tostring(spell:IsSpellCard()) .. "/" .. tostring(c:IsSpellCard()) .. "/" .. tostring(spell:IsSpellTrapCard()) .. "/" .. tostring(trapmonster:IsSpellTrapCard()) .. "/" .. tostring(c:IsSpellTrapCard()) .. "/" .. tostring(spell:IsEquipCard()) .. "/" .. tostring(equip:IsEquipCard()) .. "/" .. tostring(spell:IsEquipSpell()) .. "/" .. tostring(equip:IsEquipSpell()) .. "/" .. tostring(fieldspell:IsFieldSpell()) .. "/" .. tostring(spell:IsFieldSpell()) .. "/" .. tostring(quickplay:IsQuickPlaySpell()) .. "/" .. tostring(spell:IsQuickPlaySpell()) .. "/" .. tostring(trapmonster:IsTrapCard()) .. "/" .. tostring(trapmonster:IsTrapMonster()) .. "/" .. tostring(spell:IsTrapMonster()) .. "/" .. TYPE_EQUIP)
      Debug.Message("cost checks " .. tostring(c:IsDiscardable()) .. "/" .. tostring(c:IsAbleToGraveAsCost()))
      Duel.SendtoGrave(c, REASON_EFFECT)
      Debug.Message("cost after move " .. tostring(c:IsDiscardable()) .. "/" .. tostring(c:IsAbleToGraveAsCost()))
      Debug.Message("spell material checks " .. tostring(spell:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(spell:IsCanBeRitualMaterial(nil)))
      `,
      "card-stats.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("type 33");
    expect(host.messages).toContain("exact type true/false");
    expect(host.messages).toContain("stats 2500/2100/7");
    expect(host.messages).toContain("text stats 2500/2100/true/true");
    expect(host.messages).toContain("attack update 300/2800/2500/true/true");
    expect(host.messages).toContain("defense update -400/1700/2100/true/true");
    expect(host.messages).toContain("unknown text stats -2/-2/true/true");
    expect(host.messages).toContain("stat predicates false/true/false/true/true/true/false");
    expect(host.messages).toContain("stat varargs true/false/true/true/true/true/true");
    expect(host.messages).toContain("stat comparisons true/false/false/true/true/false");
    expect(host.messages).toContain("original stat comparisons true/true/true/true/false/true/true/true/false");
    expect(host.messages).toContain("code checks true/true/false/true/true");
    expect(host.messages).toContain("not code checks false/false/true");
    expect(host.messages).toContain("code rule checks 100/false/true/true");
    expect(host.messages).toContain("set checks true/true/true/true/false/false/false/true");
    expect(host.messages).toContain("property table filter 291/nil");
    expect(host.messages).toContain("listed checks true/true/false/true/true/true/true/false");
    expect(host.messages).toContain("material listed checks true/true/true/false/true");
    expect(host.messages).toContain("material set listed checks true/true/false/false");
    expect(host.messages).toContain("listed archetype type checks true/false/true/false/false");
    expect(host.messages).toContain("listed counter checks true/false/true/false/false");
    expect(host.messages).toContain("infinity checks true/false");
    expect(host.messages).toContain("original predicates true/true");
    expect(host.messages).toContain("not type false/true");
    expect(host.messages).toContain("not original type false/true");
    expect(host.messages).toContain("named type predicates true/false/true/false/true/false/true/false/true/false/true/false/false");
    expect(host.messages).toContain("rank 4/4/true/false/true/true/0/true");
    expect(host.messages).toContain("rank varargs true/false/true");
    expect(host.messages).toContain("rank level gates false/false");
    expect(host.messages).toContain("spirit predicate true/false");
    expect(host.messages).toContain("plus minus predicate true/true/false/false");
    expect(host.messages).toContain("has level true/false/false/false/true");
    expect(host.messages).toContain("main card types 1/2/2/5");
    expect(host.messages).toContain("rank comparisons true/false/true/true");
    expect(host.messages).toContain("rank update -3/1/4/true/true");
    expect(host.messages).toContain("link 2/2/5/true/true/true/false/true/false");
    expect(host.messages).toContain("link varargs true/false/true");
    expect(host.messages).toContain("link stat gates false/false/false/false/false/false");
    expect(host.messages).toContain("link comparisons true/false/false/true");
    expect(host.messages).toContain("link update 3/5/2/true/true");
    expect(host.messages).toContain("ritual fixed level 5");
    expect(host.messages).toContain("ritual function level 9");
    expect(host.messages).toContain("ritual summoning level 7");
    expect(host.messages).toContain("synchro levels 4/5/8");
    expect(host.messages).toContain("level update -6/1/7/true/true");
    expect(host.messages).toContain("scale hand 3/3/8/3/8/true/true/false");
    expect(host.messages).toContain("scale pzone 0/3/true/false");
    expect(host.messages).toContain("scale update -2/1/1/6/3/8/true");
    expect(host.messages).toContain("race 2 true/true");
    expect(host.messages).toContain("not race false/true");
    expect(host.messages).toContain("attribute 32 true/true");
    expect(host.messages).toContain("assumed metadata 999/4097/3/2/16/8192/1200/800/4/40");
    expect(host.messages).toContain("assumed predicates true/true/true/true/true/true/true/true");
    expect(host.messages).toContain("assumed reset 100/33/1/0/32/2/2800/1700/5/5");
    expect(host.messages).toContain("attribute except false/true/true/false");
    expect(host.messages).toContain("different attribute false/true/true/false");
    expect(host.messages).toContain("attribute strings 1014,1015");
    expect(host.messages).toContain("not attribute false/true");
    expect(host.messages).toContain("not original race false/true");
    expect(host.messages).toContain("not original attribute false/true");
    expect(host.messages).toContain("spell count 4");
    expect(host.messages).toContain("spell trap checks false/true/true/false/true/true/false/false/true/false/true/true/false/true/false/true/true/false/262144");
    expect(host.messages).toContain("cost checks true/true");
    expect(host.messages).toContain("cost after move false/false");
    expect(host.messages).toContain("spell material checks false/false");
  });

  it("checks Lua material predicates against an optional summon target", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Target Material A", kind: "monster", level: 4 },
      { code: "200", name: "Wrong Material", kind: "monster", level: 3 },
      { code: "300", name: "Target Tuner", kind: "monster", typeFlags: 0x1001, level: 2 },
      { code: "500", name: "Too Large Synchro Material", kind: "monster", level: 8 },
      { code: "600", name: "Fielded Link Target", kind: "monster", typeFlags: 0x4000001, level: 2 },
      { code: "700", name: "Fielded Xyz Target", kind: "monster", typeFlags: 0x800001, level: 4 },
      { code: "800", name: "Required Link Material", kind: "monster", level: 4 },
      { code: "900", name: "Target Fusion", kind: "extra", fusionMaterials: ["101"] },
      { code: "910", name: "Target Synchro", kind: "extra", synchroMaterials: { tuner: "300", nonTuners: ["101"] } },
      { code: "920", name: "Target Xyz", kind: "extra", typeFlags: 0x800001, level: 4 },
      { code: "930", name: "Target Link", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "940", name: "Target Ritual", kind: "monster", ritualMaterials: ["101"] },
      { code: "950", name: "Generic Synchro", kind: "extra", typeFlags: 0x2001, level: 6 },
      { code: "960", name: "Specific Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterials: ["101", "800"] },
    ];
    const session = createDuel({ seed: 58, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "500", "600", "700", "800", "940"], extra: ["900", "910", "920", "930", "950", "960"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c300 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c500 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c600 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c700 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c800 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion material pool before " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsOnField,nil))
      local fusion = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      local synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 1)
      local xyz = Duel.GetFieldCard(0, LOCATION_EXTRA, 2)
      local link = Duel.GetFieldCard(0, LOCATION_EXTRA, 3)
      local generic_synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 4)
      local specific_link = Duel.GetFieldCard(0, LOCATION_EXTRA, 5)
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion target material " .. tostring(c100:IsCanBeFusionMaterial(fusion)) .. "/" .. tostring(c200:IsCanBeFusionMaterial(fusion)))
      local selected_fusion_material = Duel.SelectFusionMaterial(0, fusion, Duel.GetFusionMaterial(0), 0)
      Debug.Message("selected fusion material " .. selected_fusion_material:GetCount() .. "/" .. selected_fusion_material:GetFirst():GetCode())
      Duel.SetFusionMaterial(Group.FromCards(c100,c200))
      Debug.Message("set fusion material " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsCode,nil,100) .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsCode,nil,200))
      Debug.Message("fusion self target material " .. tostring(fusion:IsCanBeFusionMaterial(fusion)))
      Debug.Message("ritual target material " .. tostring(c100:IsCanBeRitualMaterial(ritual)) .. "/" .. tostring(c200:IsCanBeRitualMaterial(ritual)))
      Debug.Message("ritual self target material " .. tostring(ritual:IsCanBeRitualMaterial(ritual)))
      Debug.Message("xyz target hand material " .. tostring(c100:IsCanBeXyzMaterial(xyz)))
      Duel.SpecialSummon(c100, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c200, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c300, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c700, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Debug.Message("fusion material pool after " .. Duel.GetFusionMaterial(0):GetCount() .. "/" .. Duel.GetFusionMaterial(0):FilterCount(Card.IsOnField,nil))
      Debug.Message("synchro target material " .. tostring(c300:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c200:IsCanBeSynchroMaterial(synchro)))
      Debug.Message("generic synchro target material " .. tostring(c100:IsCanBeSynchroMaterial(generic_synchro)) .. "/" .. tostring(c300:IsCanBeSynchroMaterial(generic_synchro)) .. "/" .. tostring(c500:IsCanBeSynchroMaterial(generic_synchro)))
      Debug.Message("synchro summonable " .. tostring(synchro:IsSynchroSummonable()) .. "/" .. tostring(synchro:IsSynchroSummonable(c300)) .. "/" .. tostring(synchro:IsSynchroSummonable(c200)))
      Debug.Message("generic synchro summonable " .. tostring(generic_synchro:IsSynchroSummonable(nil, Group.FromCards(c100, c300))) .. "/" .. tostring(generic_synchro:IsSynchroSummonable(nil, Group.FromCards(c100, c200))))
      Debug.Message("xyz summonable " .. tostring(xyz:IsXyzSummonable()) .. "/" .. tostring(xyz:IsXyzSummonable(c100)) .. "/" .. tostring(xyz:IsXyzSummonable(c200)))
      Duel.SendtoGrave(c200, REASON_EFFECT)
      Duel.SendtoGrave(c300, REASON_EFFECT)
      Duel.SpecialSummon(c600, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c800, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Debug.Message("xyz target field material " .. tostring(c100:IsCanBeXyzMaterial(xyz)) .. "/" .. tostring(c200:IsCanBeXyzMaterial(xyz)))
      Debug.Message("fielded xyz target material " .. tostring(c100:IsCanBeXyzMaterial(c700)) .. "/" .. tostring(c700:IsCanBeXyzMaterial(c700)))
      Debug.Message("fielded xyz summonable " .. tostring(c700:IsXyzSummonable(nil, Group.FromCards(c100, c700))) .. "/" .. tostring(c700:IsXyzSummonable(nil, Group.FromCards(c100, c200))))
      Debug.Message("link target material " .. tostring(c100:IsCanBeLinkMaterial(link)) .. "/" .. tostring(link:IsCanBeLinkMaterial(link)))
      Debug.Message("fielded link target material " .. tostring(c100:IsCanBeLinkMaterial(c600)) .. "/" .. tostring(c600:IsCanBeLinkMaterial(c600)))
      Debug.Message("link summonable " .. tostring(link:IsLinkSummonable()) .. "/" .. tostring(link:IsLinkSummonable(c100)) .. "/" .. tostring(link:IsLinkSummonable(nil, Group.FromCards(c100), 2, 2)))
      Debug.Message("specific link summonable " .. tostring(specific_link:IsLinkSummonable(nil, Group.FromCards(c100,c800), 2, 2)) .. "/" .. tostring(specific_link:IsLinkSummonable(c800, Group.FromCards(c100,c200), 2, 2)))
      `,
      "target-material-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion target material true/false");
    expect(host.messages).toContain("selected fusion material 1/100");
    expect(host.messages).toContain("set fusion material 2/1/1");
    expect(host.messages).toContain("fusion self target material false");
    expect(host.messages).toContain("ritual target material true/false");
    expect(host.messages).toContain("ritual self target material false");
    expect(host.messages).toContain("fusion material pool before 8/0");
    expect(host.messages).toContain("xyz target hand material false");
    expect(host.messages).toContain("synchro target material true/false");
    expect(host.messages).toContain("generic synchro target material true/true/false");
    expect(host.messages).toContain("synchro summonable true/true/false");
    expect(host.messages).toContain("generic synchro summonable true/false");
    expect(host.messages).toContain("xyz target field material true/false");
    expect(host.messages).toContain("fusion material pool after 2/2");
    expect(host.messages).toContain("xyz summonable true/true/false");
    expect(host.messages).toContain("fielded xyz target material true/false");
    expect(host.messages).toContain("fielded xyz summonable false/false");
    expect(host.messages).toContain("link target material true/false");
    expect(host.messages).toContain("fielded link target material true/false");
    expect(host.messages).toContain("link summonable true/true/false");
    expect(host.messages).toContain("specific link summonable true/false");
  });

  it("checks Lua reincarnation ritual material filters", () => {
    const cards: DuelCardData[] = [
      { code: "940", name: "Reincarnation Material", kind: "monster" },
      { code: "941", name: "Wrong Reincarnation Material", kind: "monster" },
      { code: "950", name: "Reincarnation Ritual", kind: "monster", typeFlags: 0x81 },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "941", "950"] },
      1: { main: ["940"] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const wrong = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "941");
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "940");
    expect(material).toBeDefined();
    expect(wrong).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    moveDuelCard(session.state, wrong!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local rc = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local wrong = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local opponent = Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      Debug.Message("reincarnation ritual " .. tostring(aux.ReincarnationRitualFilter(material, rc, 940, 0)) .. "/" .. tostring(aux.ReincarnationRitualFilter(wrong, rc, 940, 0)) .. "/" .. tostring(aux.ReincarnationRitualFilter(opponent, rc, 940, 0)))
      `,
      "reincarnation-ritual-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("reincarnation ritual true/false/false");
  });

  it("checks Lua card summon predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summonable Monster", kind: "monster", level: 4 },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Tribute Monster", kind: "monster", level: 7 },
      { code: "400", name: "Extra Deck Monster", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "500", name: "Fixture Trap", kind: "trap", typeFlags: 0x4 },
      { code: "600", name: "Zone Filler A", kind: "monster" },
      { code: "700", name: "Zone Filler B", kind: "monster" },
      { code: "800", name: "Zone Filler C", kind: "monster" },
      { code: "810", name: "Zone Filler D", kind: "monster" },
      { code: "820", name: "Zone Filler E", kind: "monster" },
      { code: "830", name: "Set Filler A", kind: "spell", typeFlags: 0x2 },
      { code: "840", name: "Set Filler B", kind: "spell", typeFlags: 0x2 },
      { code: "850", name: "Set Filler C", kind: "spell", typeFlags: 0x2 },
      { code: "860", name: "Set Filler D", kind: "spell", typeFlags: 0x2 },
      { code: "870", name: "Set Filler E", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 87, startingHandSize: 14, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "500", "600", "700", "800", "810", "820", "830", "840", "850", "860", "870"], extra: ["400"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local normal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local extra = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("summonable predicates " .. tostring(normal:IsSummonableCard()) .. "/" .. tostring(spell:IsSummonableCard()) .. "/" .. tostring(tribute:IsSummonableCard()))
      Debug.Message("hand cost predicates " .. tostring(normal:IsAbleToHandAsCost()) .. "/" .. tostring(spell:IsAbleToHandAsCost()) .. "/" .. tostring(extra:IsAbleToHandAsCost()))
      Debug.Message("summon or set predicates " .. tostring(normal:CanSummonOrSet()) .. "/" .. tostring(spell:CanSummonOrSet()) .. "/" .. tostring(tribute:CanSummonOrSet()) .. "/" .. tostring(normal:IsSummonable()))
      Debug.Message("special summonable predicates " .. tostring(normal:IsSpecialSummonable()) .. "/" .. tostring(spell:IsSpecialSummonable()) .. "/" .. tostring(extra:IsSpecialSummonable()))
      Debug.Message("setable predicates " .. tostring(normal:IsMSetable()) .. "/" .. tostring(spell:IsMSetable()) .. "/" .. tostring(tribute:IsMSetable()) .. "/" .. tostring(normal:IsSSetable()) .. "/" .. tostring(spell:IsSSetable()) .. "/" .. tostring(trap:IsSSetable()))
      `,
      "card-summon-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summonable predicates true/false/false");
    expect(host.messages).toContain("hand cost predicates false/false/true");
    expect(host.messages).toContain("summon or set predicates true/false/false/true");
    expect(host.messages).toContain("special summonable predicates true/false/false");
    expect(host.messages).toContain("setable predicates true/false/false/false/true/true");

    session.state.players[0].normalSummonAvailable = false;
    const countHost = createLuaScriptHost(session);
    const countResult = countHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("count blocked predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:IsMSetable()))
      Debug.Message("count ignored predicates " .. tostring(tribute:IsSummonableCard(true)) .. "/" .. tostring(tribute:IsMSetable(true)) .. "/" .. tostring(tribute:CanSummonOrSet(true)))
      `,
      "card-summon-predicate-count-block.lua",
    );
    expect(countResult.ok, countResult.error).toBe(true);
    expect(countHost.messages).toContain("count blocked predicates false/false");
    expect(countHost.messages).toContain("count ignored predicates false/false/false");
    session.state.players[0].normalSummonAvailable = true;

    for (const code of ["600", "700"]) {
      const tributeMaterial = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(tributeMaterial).toBeDefined();
      moveDuelCard(session.state, tributeMaterial!.uid, "monsterZone", 0);
    }
    session.state.players[0].normalSummonAvailable = false;
    const tributeHost = createLuaScriptHost(session);
    const tributeResult = tributeHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("tribute predicate count ignored " .. tostring(tribute:IsSummonable(true,nil,1)) .. "/" .. tostring(tribute:CanSummonOrSet(true,nil,1)))
      `,
      "card-tribute-predicate-count-block.lua",
    );
    expect(tributeResult.ok, tributeResult.error).toBe(true);
    expect(tributeHost.messages).toContain("tribute predicate count ignored true/true");
    session.state.players[0].normalSummonAvailable = true;

    const procHost = createLuaScriptHost(session);
    const procResult = procHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      aux.AddNormalSummonProcedure(tribute,true,false,1,1,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("tribute proc predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:CanSummonOrSet()))
      `,
      "card-tribute-procedure-predicates.lua",
    );
    expect(procResult.ok, procResult.error).toBe(true);
    expect(procHost.messages).toContain("tribute proc predicates true/true");

    for (const code of ["800", "810", "820"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const zoneHost = createLuaScriptHost(session);
    const zoneResult = zoneHost.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("mzone filled predicates " .. tostring(tribute:IsSummonableCard()) .. "/" .. tostring(tribute:IsMSetable()) .. "/" .. tostring(tribute:IsSpecialSummonable()))
      `,
      "card-summon-predicate-mzone-block.lua",
    );
    expect(zoneResult.ok, zoneResult.error).toBe(true);
    expect(zoneHost.messages).toContain("mzone filled predicates true/true/false");

    for (const code of ["830", "840", "850", "860", "870"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
    }
    const spellTrapHost = createLuaScriptHost(session);
    const spellTrapResult = spellTrapHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("szone blocked predicates " .. tostring(spell:IsSSetable()) .. "/" .. tostring(trap:IsSSetable()))
      `,
      "card-summon-predicate-szone-block.lua",
    );
    expect(spellTrapResult.ok, spellTrapResult.error).toBe(true);
    expect(spellTrapHost.messages).toContain("szone blocked predicates false/false");
  });

  it("uses Lua summon predicate tribute minimum overrides", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Override Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Override Tribute Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 188, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(material).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon min override " .. tostring(tribute:IsSummonable(true,nil,1)) .. "/" .. tostring(tribute:IsSummonable(true,nil,2)) .. "/" .. tostring(tribute:CanSummonOrSet(true,nil,1)))
      `,
      "card-summon-min-override.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon min override true/false/true");
  });

  it("checks Lua player summon legality with tribute metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Player Tribute Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player tribute missing " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(material,0,0,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("player tribute natural missing " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      aux.AddNormalSummonProcedure(target,true,false,1,1,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("player tribute proc ready " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      `,
      "player-tribute-summon-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player tribute missing false");
    expect(host.messages).toContain("player tribute natural missing false");
    expect(host.messages).toContain("player tribute proc ready true");
  });

  it("checks Lua player summon legality with raised tribute metadata and double tribute units", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Raised Tribute Target", kind: "monster", level: 5 },
      { code: "200", name: "Player Double Tribute Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(material,0,0,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("player raised natural " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      aux.AddNormalSummonProcedure(target,true,false,2,2,SUMMON_TYPE_TRIBUTE,1234)
      Debug.Message("player raised one unit " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      material:RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("player raised double unit " .. tostring(Duel.IsPlayerCanSummon(0,target)))
      `,
      "player-raised-double-tribute-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player raised natural true");
    expect(host.messages).toContain("player raised one unit false");
    expect(host.messages).toContain("player raised double unit true");
  });

  it("checks Lua player monster set legality with tribute materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Player Tribute Set Target", kind: "monster", level: 5 },
      { code: "200", name: "Player Plain Set Target", kind: "monster", level: 4 },
      { code: "300", name: "Set Material A", kind: "monster", level: 4 },
      { code: "400", name: "Set Material B", kind: "monster", level: 4 },
      { code: "500", name: "Set Material C", kind: "monster", level: 4 },
      { code: "600", name: "Set Material D", kind: "monster", level: 4 },
      { code: "700", name: "Set Material E", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["300", "400", "500", "600", "700"]) {
      const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local tribute_target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local plain_target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("player mset full " .. tostring(Duel.IsPlayerCanMSet(0, plain_target)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, tribute_target)))
      session_result = Duel.IsPlayerCanMSet(0, tribute_target, true)
      Debug.Message("player mset ignore count " .. tostring(session_result))
      `,
      "player-tribute-set-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("player mset full false/true");
    expect(host.messages).toContain("player mset ignore count true");
  });

  it("lets Lua scripts normal summon and set monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Source", kind: "monster", level: 4 },
      { code: "200", name: "Count Blocked Source", kind: "monster", level: 4 },
      { code: "300", name: "Set Source", kind: "monster", level: 4 },
      { code: "400", name: "Zone Blocked Source", kind: "monster", level: 4 },
      { code: "500", name: "Zone Filler A", kind: "monster" },
      { code: "600", name: "Zone Filler B", kind: "monster" },
      { code: "700", name: "Zone Filler C", kind: "monster" },
      { code: "800", name: "Zone Filler D", kind: "monster" },
      { code: "900", name: "Zone Filler E", kind: "monster" },
    ];
    const summonSession = createDuel({ seed: 88, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(summonSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(summonSession);

    const summonHost = createLuaScriptHost(summonSession);
    const summonResult = summonHost.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summon count before " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("summon result " .. Duel.Summon(first, true, nil))
      Debug.Message("summon count after " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("summon count blocked " .. Duel.Summon(second, true, nil))
      Debug.Message("summon blocked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("summon nil result " .. Duel.Summon(nil, true, nil))
      Debug.Message("summon nil operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-normal-summon.lua",
    );
    expect(summonResult.ok, summonResult.error).toBe(true);
    expect(summonHost.messages).toContain("summon count before true");
    expect(summonHost.messages).toContain("summon result 1");
    expect(summonHost.messages).toContain("summon count after false");
    expect(summonHost.messages).toContain("summon operated 1/100");
    expect(summonHost.messages).toContain("summon count blocked 0");
    expect(summonHost.messages).toContain("summon blocked operated 0");
    expect(summonHost.messages).toContain("summon nil result 0");
    expect(summonHost.messages).toContain("summon nil operated 0");
    const summoned = summonSession.state.cards.find((card) => card.code === "100");
    expect(summoned).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "normal" });

    const countSession = createDuel({ seed: 93, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(countSession, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(countSession);
    const countHost = createLuaScriptHost(countSession);
    const countResult = countHost.loadScript(
      `
      Debug.Message("manual count before " .. tostring(Duel.CheckSummonedCount()))
      Duel.IncreaseSummonedCount()
      Debug.Message("manual count after " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("manual activity " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON))
      `,
      "manual-summoned-count.lua",
    );
    expect(countResult.ok, countResult.error).toBe(true);
    expect(countHost.messages).toContain("manual count before true");
    expect(countHost.messages).toContain("manual count after false");
    expect(countHost.messages).toContain("manual activity 1/1");

    const setSession = createDuel({ seed: 89, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["300"] },
      1: { main: [] },
    });
    startDuel(setSession);
    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("mset result " .. Duel.MSet(target, true, nil))
      Debug.Message("mset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("mset empty result " .. Duel.MSet(Group.CreateGroup(), true, nil))
      Debug.Message("mset empty operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-monster-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("mset result 1");
    expect(setHost.messages).toContain("mset operated 1/300");
    expect(setHost.messages).toContain("mset empty result 0");
    expect(setHost.messages).toContain("mset empty operated 0");
    const setMonster = setSession.state.cards.find((card) => card.code === "300");
    expect(setMonster).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });

    const tributeSetSession = createDuel({ seed: 91, startingHandSize: 2, cardReader: createCardReader([...cards, { code: "950", name: "Tribute Set Source", kind: "monster", level: 5 }]) });
    loadDecks(tributeSetSession, {
      0: { main: ["950", "500"] },
      1: { main: [] },
    });
    startDuel(tributeSetSession);
    const tributeMaterial = tributeSetSession.state.cards.find((card) => card.code === "500");
    expect(tributeMaterial).toBeTruthy();
    moveDuelCard(tributeSetSession.state, tributeMaterial!.uid, "monsterZone", 0);
    registerEffect(tributeSetSession, {
      id: "tribute-set-material-sent",
      sourceUid: tributeMaterial!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      range: ["graveyard"],
      operation(ctx) {
        ctx.log(`Tribute set material trigger ${ctx.eventCard?.code ?? ""}`);
      },
    });
    const tributeSetHost = createLuaScriptHost(tributeSetSession);
    const tributeSetResult = tributeSetHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("tribute mset result " .. Duel.MSet(target, true, tribute))
      Debug.Message("tribute mset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "tribute-monster-set.lua",
    );
    expect(tributeSetResult.ok, tributeSetResult.error).toBe(true);
    expect(tributeSetHost.messages).toContain("tribute mset result 1");
    expect(tributeSetHost.messages).toContain("tribute mset operated 1/950");
    expect(tributeSetSession.state.cards.find((card) => card.code === "950")).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false, summonType: "tribute" });
    expect(tributeSetSession.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "graveyard" });
    expect(tributeSetSession.state.pendingTriggers.map((trigger) => trigger.effectId)).toContain("tribute-set-material-sent");

    const lockedTributeSetSession = createDuel({ seed: 92, startingHandSize: 2, cardReader: createCardReader([...cards, { code: "950", name: "Locked Tribute Set Source", kind: "monster", level: 5 }]) });
    loadDecks(lockedTributeSetSession, {
      0: { main: ["950", "500"] },
      1: { main: [] },
    });
    startDuel(lockedTributeSetSession);
    const lockedTributeMaterial = lockedTributeSetSession.state.cards.find((card) => card.code === "500");
    expect(lockedTributeMaterial).toBeTruthy();
    moveDuelCard(lockedTributeSetSession.state, lockedTributeMaterial!.uid, "monsterZone", 0);
    const lockedTributeSetHost = createLuaScriptHost(lockedTributeSetSession);
    const lockedTributeSetResult = lockedTributeSetHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local e=Effect.CreateEffect(tribute:GetFirst())
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UNRELEASABLE_SUM)
      e:SetRange(LOCATION_MZONE)
      tribute:GetFirst():RegisterEffect(e)
      Debug.Message("locked tribute mset result " .. Duel.MSet(target, true, tribute))
      Debug.Message("locked tribute mset operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "locked-tribute-monster-set.lua",
    );
    expect(lockedTributeSetResult.ok, lockedTributeSetResult.error).toBe(true);
    expect(lockedTributeSetHost.messages).toContain("locked tribute mset result 0");
    expect(lockedTributeSetHost.messages).toContain("locked tribute mset operated 0");
    expect(lockedTributeSetSession.state.cards.find((card) => card.code === "950")).toMatchObject({ location: "hand" });
    expect(lockedTributeSetSession.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "monsterZone" });

    const fullSession = createDuel({ seed: 90, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(fullSession, {
      0: { main: ["400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(fullSession);
    for (const code of ["500", "600", "700", "800", "900"]) {
      const filler = fullSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(fullSession.state, filler!.uid, "monsterZone", 0);
    }
    const fullHost = createLuaScriptHost(fullSession);
    const fullResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summon zone blocked " .. Duel.Summon(target, true, nil))
      Debug.Message("mset zone blocked " .. Duel.MSet(target, true, nil))
      `,
      "basic-summon-zone-block.lua",
    );
    expect(fullResult.ok, fullResult.error).toBe(true);
    expect(fullHost.messages).toContain("summon zone blocked 0");
    expect(fullHost.messages).toContain("mset zone blocked 0");
  });

  it("lets Lua scripts choose between normal summoning and setting monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Or Set Normal", kind: "monster", level: 4 },
      { code: "200", name: "Summon Or Set Tribute", kind: "monster", level: 5 },
      { code: "300", name: "Summon Or Set Plain Set", kind: "monster", level: 4 },
    ];
    const summonSession = createDuel({ seed: 152, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(summonSession, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(summonSession);

    const summonHost = createLuaScriptHost(summonSession);
    const summonResult = summonHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon or set summon " .. Duel.SummonOrSet(0, target, true, nil))
      Debug.Message("summon or set summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-summon.lua",
    );
    expect(summonResult.ok, summonResult.error).toBe(true);
    expect(summonHost.messages).toContain("summon or set summon 1");
    expect(summonHost.messages).toContain("summon or set summon operated 1/100");
    expect(summonSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "normal" });

    const setSession = createDuel({ seed: 153, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["300"] },
      1: { main: [] },
    });
    startDuel(setSession);

    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon or set set " .. Duel.SummonOrSet(0, target, true, nil))
      Debug.Message("summon or set set operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("summon or set set 1");
    expect(setHost.messages).toContain("summon or set set operated 1/300");
    expect(setSession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });

    const tributeSession = createDuel({ seed: 154, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(tributeSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(tributeSession);
    const material = tributeSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeDefined();
    moveDuelCard(tributeSession.state, material!.uid, "monsterZone", 0);

    const tributeHost = createLuaScriptHost(tributeSession);
    const tributeResult = tributeHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("summon or set tribute " .. Duel.SummonOrSet(0, target, true, tribute))
      Debug.Message("summon or set tribute operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-tribute.lua",
    );
    expect(tributeResult.ok, tributeResult.error).toBe(true);
    expect(tributeHost.messages).toContain("summon or set tribute 1");
    expect(tributeHost.messages).toContain("summon or set tribute operated 1/200");
    expect(tributeSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "tribute" });
    expect(tributeSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
  });

  it("lets Lua scripts set spells and traps", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Set Spell", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Set Trap", kind: "trap", typeFlags: 0x4 },
      { code: "300", name: "Rejected Monster", kind: "monster" },
      { code: "400", name: "Zone Blocked Spell", kind: "spell", typeFlags: 0x2 },
      { code: "500", name: "Zone Filler A", kind: "spell", typeFlags: 0x2 },
      { code: "600", name: "Zone Filler B", kind: "spell", typeFlags: 0x2 },
      { code: "700", name: "Zone Filler C", kind: "spell", typeFlags: 0x2 },
      { code: "800", name: "Zone Filler D", kind: "spell", typeFlags: 0x2 },
      { code: "900", name: "Zone Filler E", kind: "spell", typeFlags: 0x2 },
      { code: "1000", name: "Deck Set Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const setSession = createDuel({ seed: 91, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(setSession);

    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("sset spell result " .. Duel.SSet(spell))
      Debug.Message("sset spell operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("sset trap result " .. Duel.SSet(trap))
      Debug.Message("sset monster rejected " .. Duel.SSet(monster))
      Debug.Message("sset rejected operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("sset empty result " .. Duel.SSet(Group.CreateGroup()))
      Debug.Message("sset empty operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("can set spell trap hand " .. tostring(Duel.CanPlayerSetSpellTrap(0, spell:GetFirst())) .. "/" .. tostring(Duel.CanPlayerSetSpellTrap(0, monster:GetFirst())))
      `,
      "basic-spell-trap-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("sset spell result 1");
    expect(setHost.messages).toContain("sset spell operated 1/100");
    expect(setHost.messages).toContain("sset trap result 1");
    expect(setHost.messages).toContain("sset monster rejected 0");
    expect(setHost.messages).toContain("sset rejected operated 0");
    expect(setHost.messages).toContain("sset empty result 0");
    expect(setHost.messages).toContain("sset empty operated 0");
    expect(setHost.messages).toContain("can set spell trap hand true/false");
    expect(setSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(setSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });

    const fullSession = createDuel({ seed: 92, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(fullSession, {
      0: { main: ["400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(fullSession);
    for (const code of ["500", "600", "700", "800", "900"]) {
      const filler = fullSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(fullSession.state, filler!.uid, "spellTrapZone", 0);
    }
    const fullHost = createLuaScriptHost(fullSession);
    const fullResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("sset zone blocked " .. Duel.SSet(target))
      `,
      "basic-spell-trap-set-zone-block.lua",
    );
    expect(fullResult.ok, fullResult.error).toBe(true);
    expect(fullHost.messages).toContain("sset zone blocked 0");
    const blockedResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can set spell trap blocked " .. tostring(Duel.CanPlayerSetSpellTrap(0, target)))
      `,
      "basic-spell-trap-set-can-blocked.lua",
    );
    expect(blockedResult.ok, blockedResult.error).toBe(true);
    expect(fullHost.messages).toContain("can set spell trap blocked false");

    const trapMonsterSession = createDuel({ seed: 159, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(trapMonsterSession, {
      0: { main: ["200", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(trapMonsterSession);
    const trapMonster = trapMonsterSession.state.cards.find((card) => card.code === "200");
    moveDuelCard(trapMonsterSession.state, trapMonster!.uid, "monsterZone", 0);
    const trapMonsterHost = createLuaScriptHost(trapMonsterSession);
    const trapMonsterResult = trapMonsterHost.loadScript(
      `
      local trap_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can set trap monster " .. tostring(Duel.CanPlayerSetSpellTrap(0, trap_monster)))
      `,
      "basic-spell-trap-set-can-trap-monster.lua",
    );
    expect(trapMonsterResult.ok, trapMonsterResult.error).toBe(true);
    expect(trapMonsterHost.messages).toContain("can set trap monster true");

    const deckSetSession = createDuel({ seed: 160, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(deckSetSession, {
      0: { main: ["1000"] },
      1: { main: [] },
    });
    startDuel(deckSetSession);
    const deckSetHost = createLuaScriptHost(deckSetSession);
    const deckSetResult = deckSetHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1000), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      Debug.Message("deck ssetable " .. tostring(spell:IsSSetable()))
      Debug.Message("deck sset result " .. Duel.SSet(0, spell))
      Debug.Message("deck sset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "basic-spell-trap-set-from-deck.lua",
    );
    expect(deckSetResult.ok, deckSetResult.error).toBe(true);
    expect(deckSetHost.messages).toContain("deck ssetable true");
    expect(deckSetHost.messages).toContain("deck sset result 1");
    expect(deckSetHost.messages).toContain("deck sset operated 1/1000");
    expect(deckSetSession.state.cards.find((card) => card.code === "1000")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
  });

  it("lets Lua scripts tribute summon with explicit release cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Tribute Summon Target", kind: "monster", level: 7 },
      { code: "200", name: "Tribute A", kind: "monster", level: 4 },
      { code: "300", name: "Tribute B", kind: "monster", level: 4 },
      { code: "400", name: "Wrong Hand Tribute", kind: "monster", level: 4 },
    ];
    const successSession = createDuel({ seed: 93, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(successSession, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(successSession);
    for (const code of ["200", "300"]) {
      const tribute = successSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(successSession.state, tribute!.uid, "monsterZone", 0);
    }

    const successHost = createLuaScriptHost(successSession);
    const successResult = successHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tributes = Duel.SelectMatchingCard(0, function(c) return c:IsCode(200) or c:IsCode(300) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      Debug.Message("tribute summon result " .. Duel.Summon(target, true, tributes))
      Debug.Message("tribute summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("tribute summoned predicate " .. tostring(Duel.GetOperatedGroup():GetFirst():IsTributeSummoned()))
      `,
      "basic-tribute-summon.lua",
    );
    expect(successResult.ok, successResult.error).toBe(true);
    expect(successHost.messages).toContain("tribute summon result 1");
    expect(successHost.messages).toContain("tribute summon operated 1/100");
    expect(successHost.messages).toContain("tribute summoned predicate true");
    expect(successSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "tribute" });
    expect(successSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(successSession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });

    const tableSession = createDuel({ seed: 94, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(tableSession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(tableSession);
    for (const code of ["200", "300"]) {
      const tribute = tableSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(tableSession.state, tribute!.uid, "monsterZone", 0);
    }
    const tableHost = createLuaScriptHost(tableSession);
    const tableResult = tableHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local tribute_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("tribute table result " .. Duel.Summon(target, true, {tribute_a, tribute_b}))
      `,
      "basic-tribute-table-summon.lua",
    );
    expect(tableResult.ok, tableResult.error).toBe(true);
    expect(tableHost.messages).toContain("tribute table result 1");
    expect(tableSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "tribute" });

    const doubleSession = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(doubleSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(doubleSession);
    const doubleMaterial = doubleSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    moveDuelCard(doubleSession.state, doubleMaterial!.uid, "monsterZone", 0);
    const doubleHost = createLuaScriptHost(doubleSession);
    const doubleResult = doubleHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      tribute:GetFirst():RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("tribute double summon result " .. Duel.Summon(target, true, tribute))
      Debug.Message("tribute double operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "basic-double-tribute-summon.lua",
    );
    expect(doubleResult.ok, doubleResult.error).toBe(true);
    expect(doubleHost.messages).toContain("tribute double summon result 1");
    expect(doubleHost.messages).toContain("tribute double operated 1/100");
    expect(doubleSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    expect(doubleSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });

    const overpaySession = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(overpaySession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(overpaySession);
    for (const code of ["200", "300"]) {
      const tribute = overpaySession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(overpaySession.state, tribute!.uid, "monsterZone", 0);
    }
    const overpayHost = createLuaScriptHost(overpaySession);
    const overpayResult = overpayHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, function(c) return c:IsCode(200) or c:IsCode(300) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      tribute:Filter(Card.IsCode,nil,200):GetFirst():RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("tribute double overpay result " .. Duel.Summon(target, true, tribute))
      Debug.Message("tribute double overpay operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-double-tribute-overpay.lua",
    );
    expect(overpayResult.ok, overpayResult.error).toBe(true);
    expect(overpayHost.messages).toContain("tribute double overpay result 0");
    expect(overpayHost.messages).toContain("tribute double overpay operated 0");
    expect(overpaySession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "hand" });
    expect(overpaySession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone" });
    expect(overpaySession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "monsterZone" });

    const failureSession = createDuel({ seed: 95, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(failureSession, {
      0: { main: ["100", "400"] },
      1: { main: [] },
    });
    startDuel(failureSession);
    const failureHost = createLuaScriptHost(failureSession);
    const failureResult = failureHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local wrong = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("tribute missing result " .. Duel.Summon(target, true, nil))
      Debug.Message("tribute wrong result " .. Duel.Summon(target, true, wrong))
      Debug.Message("tribute wrong operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-tribute-summon-failures.lua",
    );
    expect(failureResult.ok, failureResult.error).toBe(true);
    expect(failureHost.messages).toContain("tribute missing result 0");
    expect(failureHost.messages).toContain("tribute wrong result 0");
    expect(failureHost.messages).toContain("tribute wrong operated 0");
    expect(failureSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "hand" });
  });

  it("lets Lua scripts special summon through step and complete", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Step Summon A", kind: "monster", level: 4 },
      { code: "200", name: "Step Summon B", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("step first " .. tostring(Duel.SpecialSummonStep(first, 0, 0, 0, false, false, POS_FACEUP_DEFENSE)))
      Debug.Message("step second blocked " .. tostring(Duel.SpecialSummonStep(second, 0, 0, 0, false, false, POS_FACEUP_ATTACK, 0x1)))
      Debug.Message("step second " .. tostring(Duel.SpecialSummonStep(second, 0, 0, 0, false, false, POS_FACEUP_ATTACK, 0x4)))
      Debug.Message("step second seq " .. second:GetSequence())
      Duel.SpecialSummonComplete()
      Debug.Message("step operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("step repeat " .. tostring(Duel.SpecialSummonStep(first, 0, 0, 0, false, false, POS_FACEUP_ATTACK)))
      `,
      "special-summon-step-complete.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("step first true");
    expect(host.messages).toContain("step second blocked false");
    expect(host.messages).toContain("step second true");
    expect(host.messages).toContain("step second seq 2");
    expect(host.messages).toContain("step operated 2/100");
    expect(host.messages).toContain("step repeat false");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", position: "faceUpDefense", summonType: "special" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "special" });
  });

  it("lets Lua scripts change battle positions for cards and groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Position A", kind: "monster" },
      { code: "200", name: "Position B", kind: "monster" },
      { code: "300", name: "Position C", kind: "monster" },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local group = Duel.SelectMatchingCard(0, function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE, 0, 1, 2, nil)
      Debug.Message("change group " .. Duel.ChangePosition(group, POS_FACEUP_DEFENSE))
      Debug.Message("change operated " .. Duel.GetOperatedGroup():GetCount())
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local third = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("change repeat blocked " .. Duel.ChangePosition(first, POS_FACEUP_ATTACK))
      Debug.Message("change repeat operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("change invalid " .. Duel.ChangePosition(third, 2))
      Debug.Message("change invalid operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "change-position.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("change group 2");
    expect(host.messages).toContain("change operated 2");
    expect(host.messages).toContain("change repeat blocked 0");
    expect(host.messages).toContain("change repeat operated 0");
    expect(host.messages).toContain("change invalid 0");
    expect(host.messages).toContain("change invalid operated 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ position: "faceUpAttack", faceUp: true });
  });

  it("lets Lua scripts toggle Rush face-up attack or face-down defense", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rush Attack", kind: "monster" },
      { code: "200", name: "Rush Set", kind: "monster" },
      { code: "300", name: "Rush Defense", kind: "monster" },
    ];
    const session = createDuel({ seed: 156, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const attack = session.state.cards.find((card) => card.code === "100");
    const set = session.state.cards.find((card) => card.code === "200");
    const defense = session.state.cards.find((card) => card.code === "300");
    expect(attack).toBeDefined();
    expect(set).toBeDefined();
    expect(defense).toBeDefined();
    moveDuelCard(session.state, attack!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, set!.uid, "monsterZone", 0).position = "faceDownDefense";
    set!.faceUp = false;
    moveDuelCard(session.state, defense!.uid, "monsterZone", 0).position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local attack = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local set = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local defense = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.ChangeToFaceupAttackOrFacedownDefense(attack, 0)
      Debug.Message("rush attack toggle " .. attack:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Duel.ChangeToFaceupAttackOrFacedownDefense(set, 0)
      Debug.Message("rush set toggle " .. set:GetPosition() .. "/" .. tostring(set:IsFaceup()))
      Duel.ChangeToFaceupAttackOrFacedownDefense(defense, 0)
      Debug.Message("rush defense toggle " .. defense:GetPosition())
      Duel.ChangeToFaceupAttackOrFacedownDefense(defense, 0)
      Debug.Message("rush repeat operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "rush-position-toggle.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("rush attack toggle 8/100");
    expect(host.messages).toContain("rush set toggle 1/true");
    expect(host.messages).toContain("rush defense toggle 1");
    expect(host.messages).toContain("rush repeat operated 0");
    expect(attack).toMatchObject({ position: "faceDownDefense", faceUp: false });
    expect(set).toMatchObject({ position: "faceUpAttack", faceUp: true });
    expect(defense).toMatchObject({ position: "faceUpAttack", faceUp: true });
  });

  it("lets Lua scripts swap field card sequences", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Monster A", kind: "monster" },
      { code: "200", name: "Monster B", kind: "monster" },
      { code: "300", name: "Spell A", kind: "spell", typeFlags: 0x2 },
      { code: "400", name: "Trap B", kind: "trap", typeFlags: 0x4 },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    for (const code of ["300", "400"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local monster_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local trap_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("monster before " .. monster_a:GetSequence() .. "/" .. monster_b:GetSequence())
      Debug.Message("monster sequence predicate before " .. tostring(monster_a:IsSequence(0)) .. "/" .. tostring(monster_a:IsSequence(1)))
      Debug.Message("swap monster " .. Duel.SwapSequence(monster_a, monster_b))
      Debug.Message("monster after " .. monster_a:GetSequence() .. "/" .. monster_b:GetSequence())
      Debug.Message("monster sequence predicate after " .. tostring(monster_a:IsSequence(0)) .. "/" .. tostring(monster_a:IsSequence(1)))
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("spell before " .. spell_a:GetSequence() .. "/" .. trap_b:GetSequence())
      Debug.Message("swap spelltrap " .. Duel.SwapSequence(spell_a, trap_b))
      Debug.Message("spell after " .. spell_a:GetSequence() .. "/" .. trap_b:GetSequence())
      Debug.Message("swap different zones " .. Duel.SwapSequence(monster_a, spell_a))
      Debug.Message("swap different operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("swap self " .. Duel.SwapSequence(monster_a, monster_a))
      Debug.Message("swap self operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-sequence.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("monster before 0/1");
    expect(host.messages).toContain("monster sequence predicate before true/false");
    expect(host.messages).toContain("swap monster 1");
    expect(host.messages).toContain("monster after 1/0");
    expect(host.messages).toContain("monster sequence predicate after false/true");
    expect(host.messages).toContain("swap operated 2");
    expect(host.messages).toContain("spell before 0/1");
    expect(host.messages).toContain("swap spelltrap 1");
    expect(host.messages).toContain("spell after 1/0");
    expect(host.messages).toContain("swap different zones 0");
    expect(host.messages).toContain("swap different operated 0");
    expect(host.messages).toContain("swap self 0");
    expect(host.messages).toContain("swap self operated 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ sequence: 0 });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "400")).toMatchObject({ sequence: 0 });
  });

  it("lets Lua scripts move field card sequences", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Monster A", kind: "monster" },
      { code: "200", name: "Monster B", kind: "monster" },
      { code: "300", name: "Monster C", kind: "monster" },
      { code: "400", name: "Spell A", kind: "spell", typeFlags: 0x2 },
      { code: "500", name: "Trap B", kind: "trap", typeFlags: 0x4 },
      { code: "600", name: "Opponent Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: ["600"] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    for (const code of ["400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
    }
    const opponentCard = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.code === "600");
    moveDuelCard(session.state, opponentCard!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local monster_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local monster_c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local trap_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("move monster " .. Duel.MoveSequence(monster_c, 0))
      Debug.Message("move monster operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("monster order " .. monster_a:GetSequence() .. "/" .. monster_b:GetSequence() .. "/" .. monster_c:GetSequence())
      Debug.Message("move noop " .. Duel.MoveSequence(monster_c, 0))
      Debug.Message("move noop operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move range " .. Duel.MoveSequence(monster_c, 4))
      Debug.Message("move range operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move spelltrap " .. Duel.MoveSequence(trap_b, 0))
      Debug.Message("spell order " .. spell_a:GetSequence() .. "/" .. trap_b:GetSequence())
      Debug.Message("monster order after spell " .. monster_a:GetSequence() .. "/" .. monster_b:GetSequence() .. "/" .. monster_c:GetSequence())
      Debug.Message("field mzone codes " .. Duel.GetFieldCard(0, LOCATION_MZONE, 0):GetCode() .. "/" .. Duel.GetFieldCard(0, LOCATION_MZONE, 1):GetCode() .. "/" .. Duel.GetFieldCard(0, LOCATION_MZONE, 2):GetCode())
      Debug.Message("field szone codes " .. Duel.GetFieldCard(0, LOCATION_SZONE, 0):GetCode() .. "/" .. Duel.GetFieldCard(0, LOCATION_SZONE, 1):GetCode())
      Debug.Message("field opponent code " .. Duel.GetFieldCard(1, LOCATION_MZONE, 0):GetCode())
      Debug.Message("field empty cards " .. tostring(Duel.GetFieldCard(0, LOCATION_MZONE, 3) == nil) .. "/" .. tostring(Duel.GetFieldCard(0, LOCATION_SZONE, 2) == nil))
      `,
      "move-sequence.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("move monster 1");
    expect(host.messages).toContain("move monster operated 1/300");
    expect(host.messages).toContain("monster order 1/2/0");
    expect(host.messages).toContain("move noop 0");
    expect(host.messages).toContain("move noop operated 0");
    expect(host.messages).toContain("move range 0");
    expect(host.messages).toContain("move range operated 0");
    expect(host.messages).toContain("move spelltrap 1");
    expect(host.messages).toContain("spell order 1/0");
    expect(host.messages).toContain("monster order after spell 1/2/0");
    expect(host.messages).toContain("field mzone codes 300/100/200");
    expect(host.messages).toContain("field szone codes 500/400");
    expect(host.messages).toContain("field opponent code 600");
    expect(host.messages).toContain("field empty cards true/true");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ sequence: 2 });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ sequence: 0 });
    expect(session.state.cards.find((card) => card.code === "400")).toMatchObject({ sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ sequence: 0 });
  });

  it("lets Lua scripts shuffle set card sequences", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Set A", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Set B", kind: "trap", typeFlags: 0x4 },
      { code: "300", name: "Set C", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
      card!.faceUp = false;
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local set_cards = Duel.GetFieldGroup(0, LOCATION_SZONE, 0)
      Duel.ShuffleSetCard(set_cards)
      Debug.Message("shuffle set operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("shuffle set seqs " .. Duel.GetFieldCard(0, LOCATION_SZONE, 0):GetSequence() .. "/" .. Duel.GetFieldCard(0, LOCATION_SZONE, 1):GetSequence() .. "/" .. Duel.GetFieldCard(0, LOCATION_SZONE, 2):GetSequence())
      `,
      "shuffle-set-card.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("shuffle set operated 3");
    expect(host.messages).toContain("shuffle set seqs 0/1/2");
    expect(session.state.cards.filter((card) => card.location === "spellTrapZone").map((card) => card.sequence).sort()).toEqual([0, 1, 2]);
  });

  it("lets Lua scripts move cards onto field zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Filler A", kind: "monster" },
      { code: "200", name: "Field Filler B", kind: "monster" },
      { code: "300", name: "Field Filler C", kind: "monster" },
      { code: "400", name: "Field Filler D", kind: "monster" },
      { code: "500", name: "Field Filler E", kind: "monster" },
      { code: "600", name: "Moved Monster", kind: "monster" },
      { code: "700", name: "Blocked Monster", kind: "monster" },
      { code: "800", name: "Moved Spell", kind: "spell", typeFlags: 0x2 },
      { code: "900", name: "Invalid Move", kind: "monster" },
    ];
    const session = createDuel({ seed: 99, startingHandSize: 9, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local invalid = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("move to opponent mzone " .. Duel.MoveToField(monster, 0, 1, LOCATION_MZONE, POS_FACEUP_ATTACK, true))
      Debug.Message("move field operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("move blocked full " .. Duel.MoveToField(blocked, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK, true))
      Debug.Message("move blocked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move to szone " .. Duel.MoveToField(spell, 0, 0, LOCATION_SZONE, POS_FACEDOWN_DEFENSE, true))
      Debug.Message("move szone operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("move invalid dest " .. Duel.MoveToField(invalid, 0, 0, LOCATION_GRAVE, POS_FACEUP_ATTACK, true))
      Debug.Message("move invalid operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "move-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("move to opponent mzone 1");
    expect(host.messages).toContain("move field operated 1/600");
    expect(host.messages).toContain("move blocked full 0");
    expect(host.messages).toContain("move blocked operated 0");
    expect(host.messages).toContain("move to szone 1");
    expect(host.messages).toContain("move szone operated 1/800");
    expect(host.messages).toContain("move invalid dest 0");
    expect(host.messages).toContain("move invalid operated 0");
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 1, location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "700")).toMatchObject({ controller: 0, location: "hand" });
    expect(session.state.cards.find((card) => card.code === "800")).toMatchObject({ controller: 0, location: "spellTrapZone", position: "faceDownDefense", faceUp: false });
    expect(session.state.cards.find((card) => card.code === "900")).toMatchObject({ controller: 0, location: "hand" });
  });

  it("lets Lua scripts return cards to their previous field zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Monster", kind: "monster" },
      { code: "200", name: "Return Override", kind: "monster" },
      { code: "300", name: "No Previous Field", kind: "monster" },
    ];
    const session = createDuel({ seed: 100, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const first = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    const second = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    moveDuelCard(session.state, first!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, first!.uid, "banished", 0);
    moveDuelCard(session.state, second!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, second!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      local invalid = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("return field first " .. tostring(Duel.ReturnToField(first)))
      Debug.Message("return operated first " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("return field second " .. tostring(Duel.ReturnToField(second, POS_FACEUP_DEFENSE)))
      Debug.Message("return operated second " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("return invalid " .. tostring(Duel.ReturnToField(invalid)))
      Debug.Message("return operated invalid " .. Duel.GetOperatedGroup():GetCount())
      `,
      "return-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("return field first true");
    expect(host.messages).toContain("return operated first 1/100");
    expect(host.messages).toContain("return field second true");
    expect(host.messages).toContain("return operated second 1/200");
    expect(host.messages).toContain("return invalid false");
    expect(host.messages).toContain("return operated invalid 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 0, location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ controller: 0, location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ controller: 0, location: "hand" });
  });

  it("passes extra filter arguments through Lua matching helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Vararg A", kind: "monster", attack: 1600 },
      { code: "200", name: "Vararg B", kind: "monster", attack: 900 },
      { code: "300", name: "Vararg C", kind: "monster", attack: 2000 },
    ];
    const session = createDuel({ seed: 23, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const handResult = host.loadScript(
      `
      local function match(c, code, minatk)
        return c:IsCode(code) and c:GetAttack() >= minatk
      end
      local selected = Duel.SelectMatchingCard(0, match, 0, LOCATION_HAND, 0, 1, 1, nil, 100, 1500)
      Debug.Message("vararg selected " .. selected:GetFirst():GetCode())
      Debug.Message("vararg count " .. Duel.GetMatchingGroupCount(match, 0, LOCATION_HAND, 0, nil, 300, 1800))
      Debug.Message("vararg existing " .. tostring(Duel.IsExistingMatchingCard(match, 0, LOCATION_HAND, 0, 1, nil, 200, 1000)))
      Debug.Message("duel sum check " .. tostring(Duel.CheckWithSumEqual(Card.GetAttack, 0, LOCATION_HAND, 0, 2500, 2, 2, nil)))
      Debug.Message("duel sum miss " .. tostring(Duel.CheckWithSumEqual(Card.GetAttack, 0, LOCATION_HAND, 0, 4500, 2, 2, nil)))
      Debug.Message("duel sum greater check " .. tostring(Duel.CheckWithSumGreater(Card.GetAttack, 0, LOCATION_HAND, 0, 3500, 2, 2, nil)))
      Debug.Message("duel sum greater miss " .. tostring(Duel.CheckWithSumGreater(Card.GetAttack, 0, LOCATION_HAND, 0, 5500, 2, 2, nil)))
      Debug.Message("duel sum vararg check " .. tostring(Duel.CheckWithSumEqual(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3600, 2, 2, nil, 1500)))
      Debug.Message("duel sum vararg miss " .. tostring(Duel.CheckWithSumEqual(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 4500, 2, 2, nil, 1500)))
      Debug.Message("duel sum greater vararg check " .. tostring(Duel.CheckWithSumGreater(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3500, 2, 2, nil, 1500)))
      Debug.Message("duel sum greater vararg miss " .. tostring(Duel.CheckWithSumGreater(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 4500, 2, 2, nil, 1500)))
      local sum_selected = Duel.SelectWithSumEqual(0, Card.GetAttack, 0, LOCATION_HAND, 0, 3600, 2, 2, nil)
      Debug.Message("duel sum selected " .. sum_selected:GetCount())
      local sum_greater_selected = Duel.SelectWithSumGreater(0, Card.GetAttack, 0, LOCATION_HAND, 0, 3500, 2, 2, nil)
      Debug.Message("duel sum greater selected " .. sum_greater_selected:GetCount())
      local vararg_sum = Duel.SelectWithSumEqual(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3600, 2, 2, nil, 1500)
      Debug.Message("duel sum vararg " .. vararg_sum:GetCount())
      local vararg_greater_sum = Duel.SelectWithSumGreater(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3500, 2, 2, nil, 1500)
      Debug.Message("duel sum greater vararg " .. vararg_greater_sum:GetCount())
      local function subgroup_attack(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end
      Debug.Message("duel subgroup check " .. tostring(Duel.CheckSubGroup(subgroup_attack, 0, LOCATION_HAND, 0, 2, 2, nil, 3500)))
      Debug.Message("duel subgroup miss " .. tostring(Duel.CheckSubGroup(subgroup_attack, 0, LOCATION_HAND, 0, 2, 2, nil, 5000)))
      local subgroup = Duel.SelectSubGroup(0, subgroup_attack, false, 0, LOCATION_HAND, 0, 2, 2, nil, 3500)
      Debug.Message("duel subgroup selected " .. subgroup:GetCount())
      `,
      "matching-varargs.lua",
    );

    expect(handResult.ok).toBe(true);
    expect(host.messages).toContain("vararg selected 100");
    expect(host.messages).toContain("vararg count 1");
    expect(host.messages).toContain("vararg existing false");
    expect(host.messages).toContain("duel sum check true");
    expect(host.messages).toContain("duel sum miss false");
    expect(host.messages).toContain("duel sum greater check true");
    expect(host.messages).toContain("duel sum greater miss false");
    expect(host.messages).toContain("duel sum vararg check true");
    expect(host.messages).toContain("duel sum vararg miss false");
    expect(host.messages).toContain("duel sum greater vararg check true");
    expect(host.messages).toContain("duel sum greater vararg miss false");
    expect(host.messages).toContain("duel sum selected 2");
    expect(host.messages).toContain("duel sum greater selected 2");
    expect(host.messages).toContain("duel sum vararg 2");
    expect(host.messages).toContain("duel sum greater vararg 2");
    expect(host.messages).toContain("duel subgroup check true");
    expect(host.messages).toContain("duel subgroup miss false");
    expect(host.messages).toContain("duel subgroup selected 2");

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }
    const releaseResult = host.loadScript(
      `
      local function release_filter(c, minatk)
        return c:GetAttack() >= minatk
      end
      Debug.Message("vararg release check " .. tostring(Duel.CheckReleaseGroup(0, release_filter, 2, nil, 1500)))
      Debug.Message("vararg release ex check " .. tostring(Duel.CheckReleaseGroupEx(0, release_filter, 2, 2, nil, 1500)))
      local g = Duel.SelectReleaseGroup(0, release_filter, 1, 2, nil, 1500)
      Debug.Message("vararg release selected " .. g:GetCount())
      local gx = Duel.SelectReleaseGroupEx(0, release_filter, 1, 1, nil, 1500)
      Debug.Message("vararg release ex selected " .. gx:GetCount())
      `,
      "release-varargs.lua",
    );

    expect(releaseResult.ok).toBe(true);
    expect(host.messages).toContain("vararg release check true");
    expect(host.messages).toContain("vararg release ex check true");
    expect(host.messages).toContain("vararg release selected 2");
    expect(host.messages).toContain("vararg release ex selected 1");
  });

  it("lets Lua scripts mutate and filter groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Group A", kind: "monster", attack: 1000, level: 1 },
      { code: "200", name: "Group B", kind: "monster", attack: 2000, level: 2 },
      { code: "300", name: "Group C", kind: "monster", attack: 3000, level: 3 },
    ];
    const session = createDuel({ seed: 15, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local all = Duel.GetFieldGroup(0, LOCATION_HAND, 0)
      local high = all:Filter(function(tc) return tc:GetAttack() >= 2000 end, nil)
      local vararg_high = all:Filter(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 2500)
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c300 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = Effect.CreateEffect(c100)
      Debug.Message("wrapped types " .. type(c100) .. "/" .. type(all) .. "/" .. type(e) .. "/" .. type(function() end) .. "/" .. type(1) .. "/" .. type(nil))
      local excluded_group = Group.FromCards(c200)
      local without_c200 = all:Filter(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000)
      local g = Group.CreateGroup()
      g:AddCard(c100)
      g:AddCard(c100)
      g:KeepAlive()
      Debug.Message("added unique " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      Debug.Message("contains alias " .. tostring(g:Contains(c100)) .. "/" .. tostring(g:Contains(c200)))
      g:Merge(high)
      Debug.Message("merged " .. g:GetCount() .. " " .. tostring(g:IsContains(c200)))
      local from_cards = Group.FromCards(c100, c200, c100)
      Debug.Message("from cards " .. from_cards:GetCount() .. " " .. tostring(from_cards:Equal(Group.FromCards(c200, c100))))
      local created_cards = Group.CreateGroup(c100, c200, c100)
      Debug.Message("create group cards " .. created_cards:GetCount() .. " " .. tostring(created_cards:Equal(Group.FromCards(c200, c100))))
      local added_cards = Group.FromCards(c100) + c200 + Group.FromCards(c300, c100)
      Debug.Message("group add cards " .. added_cards:GetCount() .. " " .. tostring(added_cards:Equal(Group.FromCards(c300, c200, c100))))
      local added_card_first = c300 + Group.FromCards(c100)
      Debug.Message("group add card first " .. added_card_first:GetCount() .. " " .. tostring(added_card_first:Includes(Group.FromCards(c100, c300))))
      local added_cards_only = c100 + c200
      Debug.Message("card add cards " .. added_cards_only:GetCount() .. " " .. tostring(added_cards_only:Equal(Group.FromCards(c200, c100))))
      local added_card_group = c100 + Group.FromCards(c200, c300)
      Debug.Message("card add group " .. added_card_group:GetCount() .. " " .. tostring(added_card_group:Equal(Group.FromCards(c300, c200, c100))))
      local subtracted_card = added_cards - c100
      Debug.Message("group subtract card " .. subtracted_card:GetCount() .. " " .. tostring(subtracted_card:Equal(Group.FromCards(c300, c200))) .. "/" .. tostring(added_cards:IsContains(c100)))
      local subtracted_group = added_cards - Group.FromCards(c100, c300)
      Debug.Message("group subtract group " .. subtracted_group:GetCount() .. " " .. tostring(subtracted_group:Equal(Group.FromCards(c200))))
      local intersected_card = added_cards & c200
      Debug.Message("group intersect card " .. intersected_card:GetCount() .. " " .. tostring(intersected_card:Equal(Group.FromCards(c200))))
      local intersected_group = added_cards & Group.FromCards(c100, c300)
      Debug.Message("group intersect group " .. intersected_group:GetCount() .. " " .. tostring(intersected_group:Equal(Group.FromCards(c300, c100))))
      Debug.Message("includes group " .. tostring(g:Includes(Group.FromCards(c100, c200))) .. "/" .. tostring(Group.FromCards(c100):Includes(g)) .. "/" .. tostring(g:Includes(c300)))
      local without_high = g:Clone()
      without_high:Sub(high)
      Debug.Message("sub high " .. without_high:GetCount() .. " " .. tostring(without_high:IsContains(c100)))
      without_high:Clear()
      Debug.Message("clear group " .. without_high:GetCount())
      local clone = g:Clone()
      local selected = clone:Select(0, 1, 2, nil)
      Debug.Message("selected group " .. selected:GetCount())
      Debug.Message("selected group too few " .. clone:Select(0, 4, 4, nil):GetCount())
      Debug.Message("selected group unbounded " .. clone:Select(0, 1, 0, nil):GetCount())
      local random_selected = all:RandomSelect(0, 2)
      local random_first = random_selected:GetFirst()
      local random_second = random_selected:GetNext()
      Debug.Message("random selected " .. random_selected:GetCount() .. " " .. random_first:GetCode() .. "/" .. random_second:GetCode() .. " " .. tostring(random_first:GetCode() ~= random_second:GetCode()))
      Debug.Message("random selected too many " .. all:RandomSelect(0, 4):GetCount())
      local sorted = Group.FromCards(c300, c100, c200)
      sorted:Sort(function(a,b) return a:GetAttack()<b:GetAttack() end)
      Debug.Message("sorted asc " .. sorted:GetFirst():GetCode() .. "/" .. sorted:GetNext():GetCode() .. "/" .. sorted:GetNext():GetCode())
      local sorted_desc = Group.FromCards(c100, c200, c300)
      sorted_desc:Sort(function(a,b,desc) if desc then return a:GetAttack()>b:GetAttack() end return a:GetAttack()<b:GetAttack() end, true)
      Debug.Message("sorted desc " .. sorted_desc:GetFirst():GetCode() .. "/" .. sorted_desc:GetNext():GetCode() .. "/" .. sorted_desc:GetNext():GetCode())
      local foreach_sum = 0
      local foreach_codes = ""
      all:ForEach(function(tc,prefix)
        foreach_sum = foreach_sum + tc:GetAttack()
        foreach_codes = foreach_codes .. prefix .. tc:GetCode()
      end, "#")
      Debug.Message("foreach " .. foreach_sum .. " " .. foreach_codes)
      local select_pool = Group.FromCards(c100)
      local added = all:SelectUnselect(select_pool, true, false, 1, 2)
      Debug.Message("select unselect add " .. tostring(added and added:GetCode()))
      select_pool:AddCard(added)
      local stopped = all:SelectUnselect(select_pool, true, false, 1, 2)
      Debug.Message("select unselect stop " .. tostring(stopped == nil))
      local unbounded = all:SelectUnselect(Group.CreateGroup(), true, false, 1, 0)
      Debug.Message("select unselect unbounded " .. tostring(unbounded and unbounded:GetCode()))
      Debug.Message("exists high " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 2, nil, 1500)))
      Debug.Message("filter group excluded " .. without_c200:GetCount() .. " " .. tostring(without_c200:IsContains(c200)))
      Debug.Message("filter count alias " .. all:FilterCount(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000))
      Debug.Message("exists group excluded " .. tostring(all:IsExists(aux.FilterBoolFunction(Card.IsCode, 200), 1, excluded_group)))
      Debug.Message("exists group remainder " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 1, excluded_group, 2500)))
      Debug.Message("match all " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1000):GetCount())
      Debug.Message("match miss " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1500):GetCount())
      Debug.Message("match excluded " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000):GetCount())
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      Debug.Message("bin class count " .. all:GetBinClassCount(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetCode()/100 or 0 end, 1500))
      Debug.Message("attack sum " .. all:GetSum(Card.GetAttack))
      Debug.Message("level sum " .. all:GetSum(Card.Level))
      Debug.Message("attack sum vararg " .. all:GetSum(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 1500))
      local max_group,max_attack = all:GetMaxGroup(Card.GetAttack)
      local min_group,min_attack = all:GetMinGroup(Card.GetAttack)
      Debug.Message("max group " .. max_group:GetCount() .. "/" .. max_attack .. "/" .. max_group:GetFirst():GetCode())
      Debug.Message("min group " .. min_group:GetCount() .. "/" .. min_attack .. "/" .. min_group:GetFirst():GetCode())
      local max_vararg,max_vararg_attack = all:GetMaxGroup(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 1500)
      Debug.Message("max group vararg " .. max_vararg:GetCount() .. "/" .. max_vararg_attack .. "/" .. max_vararg:GetFirst():GetCode())
      Debug.Message("sum exact " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Debug.Message("sum miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 4500, 2, 2)))
      Debug.Message("sum greater " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 3500, 2, 2)))
      Debug.Message("sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 5500, 2, 2)))
      local sum_selected = all:SelectWithSumEqual(0, Card.GetAttack, 3000, 2, 2)
      Debug.Message("sum selected " .. sum_selected:GetCount())
      local sum_greater_selected = all:SelectWithSumGreater(0, Card.GetAttack, 3500, 2, 2)
      Debug.Message("sum greater selected " .. sum_greater_selected:GetCount())
      Duel.SetSelectedCard(c300)
      Debug.Message("selected card single " .. Duel.GetSelectedCard():GetCount() .. "/" .. Duel.GetSelectedCard():GetFirst():GetCode())
      Debug.Message("forced sum exact miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Duel.SetSelectedCard(c100)
      Debug.Message("forced sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 4500, 2, 2)))
      Duel.SetSelectedCard(c200)
      local forced_sum = all:SelectWithSumGreater(0, Card.GetAttack, 4500, 2, 2)
      Debug.Message("forced sum greater selected " .. forced_sum:GetCount() .. " " .. tostring(forced_sum:IsContains(c200)))
      Duel.SetSelectedCard(nil)
      Debug.Message("selected card cleared " .. Duel.GetSelectedCard():GetCount())
      Debug.Message("forced sum cleared " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      local vararg_sum = all:SelectWithSumEqual(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 5000, 2, 2, 1500)
      Debug.Message("sum vararg " .. vararg_sum:GetCount())
      local vararg_greater_sum = all:SelectWithSumGreater(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 4500, 2, 2, 1500)
      Debug.Message("sum greater vararg " .. vararg_greater_sum:GetCount())
      local function subgroup_attack(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end
      Debug.Message("subgroup check " .. tostring(all:CheckSubGroup(subgroup_attack, 2, 2, 4000)))
      Debug.Message("subgroup miss " .. tostring(all:CheckSubGroup(subgroup_attack, 2, 2, 6000)))
      local subgroup = all:SelectSubGroup(0, subgroup_attack, false, 2, 2, 4000)
      Debug.Message("subgroup selected " .. subgroup:GetCount())
      Duel.SetSelectedCard(c300)
      local forced_subgroup = all:SelectSubGroup(0, subgroup_attack, false, 2, 2, 4000)
      Debug.Message("forced subgroup selected " .. forced_subgroup:GetCount() .. " " .. tostring(forced_subgroup:IsContains(c300)))
      Duel.SetSelectedCard(nil)
      local picked_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 2, 2, subgroup_attack, 5000)
      Debug.Message("select unselect subgroup " .. picked_subgroup:GetCount() .. " " .. tostring(picked_subgroup:IsContains(c100)))
      local missed_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 2, 2, subgroup_attack, 6000)
      Debug.Message("select unselect subgroup miss " .. missed_subgroup:GetCount())
      local plain_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 1, 0)
      Debug.Message("select unselect subgroup plain " .. plain_subgroup:GetCount() .. " " .. tostring(plain_subgroup:IsContains(c100)))
      g:RemoveCard(c100)
      g:DeleteGroup()
      Debug.Message("removed " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      Debug.Message("filtered high " .. high:GetCount())
      Debug.Message("vararg high " .. vararg_high:GetCount())
      `,
      "group-mutation.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("added unique 1 true");
    expect(host.messages).toContain("wrapped types Card/Group/Effect/function/number/nil");
    expect(host.messages).toContain("contains alias true/false");
    expect(host.messages).toContain("merged 3 true");
    expect(host.messages).toContain("from cards 2 true");
    expect(host.messages).toContain("create group cards 2 true");
    expect(host.messages).toContain("group add cards 3 true");
    expect(host.messages).toContain("group add card first 2 true");
    expect(host.messages).toContain("card add cards 2 true");
    expect(host.messages).toContain("card add group 3 true");
    expect(host.messages).toContain("group subtract card 2 true/true");
    expect(host.messages).toContain("group subtract group 1 true");
    expect(host.messages).toContain("group intersect card 1 true");
    expect(host.messages).toContain("group intersect group 2 true");
    expect(host.messages).toContain("includes group true/false/true");
    expect(host.messages).toContain("sub high 1 true");
    expect(host.messages).toContain("clear group 0");
    expect(host.messages).toContain("selected group 2");
    expect(host.messages).toContain("selected group too few 0");
    expect(host.messages).toContain("selected group unbounded 3");
    const randomSelected = host.messages.find((message) => message.startsWith("random selected 2 "));
    expect(randomSelected).toBeDefined();
    expect(randomSelected).toContain(" true");
    expect(host.messages).toContain("random selected too many 0");
    expect(host.messages).toContain("sorted asc 100/200/300");
    expect(host.messages).toContain("sorted desc 300/200/100");
    const foreachMessage = host.messages.find((message) => message.startsWith("foreach 6000 "));
    expect(foreachMessage).toBeDefined();
    expect(foreachMessage).toContain("#100");
    expect(foreachMessage).toContain("#200");
    expect(foreachMessage).toContain("#300");
    expect(host.messages).toContain("select unselect add 200");
    expect(host.messages).toContain("select unselect stop true");
    expect(host.messages).toContain("select unselect unbounded 200");
    expect(host.messages).toContain("exists high true");
    expect(host.messages).toContain("filter group excluded 2 false");
    expect(host.messages).toContain("filter count alias 2");
    expect(host.messages).toContain("exists group excluded false");
    expect(host.messages).toContain("exists group remainder true");
    expect(host.messages).toContain("match all 3");
    expect(host.messages).toContain("match miss 2");
    expect(host.messages).toContain("match excluded 2");
    expect(host.messages).toContain("class count 2");
    expect(host.messages).toContain("bin class count 2");
    expect(host.messages).toContain("attack sum 6000");
    expect(host.messages).toContain("level sum 6");
    expect(host.messages).toContain("attack sum vararg 5000");
    expect(host.messages).toContain("max group 1/3000/300");
    expect(host.messages).toContain("min group 1/1000/100");
    expect(host.messages).toContain("max group vararg 1/3000/300");
    expect(host.messages).toContain("sum exact true");
    expect(host.messages).toContain("sum miss false");
    expect(host.messages).toContain("sum greater true");
    expect(host.messages).toContain("sum greater miss false");
    expect(host.messages).toContain("sum selected 2");
    expect(host.messages).toContain("sum greater selected 2");
    expect(host.messages).toContain("selected card single 1/300");
    expect(host.messages).toContain("forced sum exact miss false");
    expect(host.messages).toContain("forced sum greater miss false");
    expect(host.messages).toContain("forced sum greater selected 2 true");
    expect(host.messages).toContain("selected card cleared 0");
    expect(host.messages).toContain("forced sum cleared true");
    expect(host.messages).toContain("sum vararg 2");
    expect(host.messages).toContain("sum greater vararg 2");
    expect(host.messages).toContain("subgroup check true");
    expect(host.messages).toContain("subgroup miss false");
    expect(host.messages).toContain("subgroup selected 2");
    expect(host.messages).toContain("forced subgroup selected 2 true");
    expect(host.messages).toContain("select unselect subgroup 2 false");
    expect(host.messages).toContain("select unselect subgroup miss 0");
    expect(host.messages).toContain("select unselect subgroup plain 2 false");
    expect(host.messages).toContain("removed 2 false");
    expect(host.messages).toContain("filtered high 2");
    expect(host.messages).toContain("vararg high 1");
  });
});

function handCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "hand")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function deckCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "deck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function extraCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "extraDeck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}
