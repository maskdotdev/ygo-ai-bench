import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua card predicate helpers", () => {
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

  it("keeps monster attribute helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Ended Type Probe", kind: "monster", typeFlags: 0x1 }];
    const session = createDuel({ seed: 207, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      c:AddMonsterAttribute(TYPE_EFFECT)
      Duel.Win(0,WIN_REASON_EXODIA)
      c:AddMonsterAttribute(TYPE_TUNER)
      Debug.Message("type kept " .. c:GetType() .. "/" .. tostring(c:IsType(TYPE_EFFECT)) .. "/" .. tostring(c:IsType(TYPE_TUNER)))
      `,
      "ended-monster-attribute-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["type kept 33/true/false"]);
    expect(session.state.status).toBe("ended");
    expect(card!.data.typeFlags).toBe(0x21);
  });

  it("applies monster attribute helper race, attribute, and nonzero stats", () => {
    const cards: DuelCardData[] = [{ code: "101", name: "Trap Monster Probe", kind: "trap", typeFlags: 0x4, level: 4, attack: 1800, defense: 1000 }];
    const session = createDuel({ seed: 208, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101"] },
      1: { main: [] },
    });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.code === "101");
    expect(card).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 101), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      c:AddMonsterAttribute(TYPE_NORMAL+TYPE_TRAP,ATTRIBUTE_LIGHT,RACE_WARRIOR,0,0,0)
      Debug.Message("trap monster kept " .. c:GetType() .. "/" .. c:GetAttribute() .. "/" .. c:GetRace() .. "/" .. c:GetLevel() .. "/" .. c:GetAttack() .. "/" .. c:GetDefense())
      c:AddMonsterAttribute(TYPE_EFFECT,ATTRIBUTE_DARK,RACE_SPELLCASTER,3,1200,700)
      Debug.Message("trap monster changed " .. c:GetType() .. "/" .. c:GetAttribute() .. "/" .. c:GetRace() .. "/" .. c:GetLevel() .. "/" .. c:GetAttack() .. "/" .. c:GetDefense())
      `,
      "monster-attribute-traits.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "trap monster kept 21/16/1/4/1800/1000",
      "trap monster changed 33/32/2/3/1200/700",
    ]);
    expect(card!.data).toMatchObject({ typeFlags: 0x21, attribute: 0x20, race: 0x2, level: 3, attack: 1200, defense: 700 });
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

});
