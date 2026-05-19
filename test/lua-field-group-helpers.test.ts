import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua field group helpers", () => {
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
      Debug.Message("stat varargs " .. tostring(c:IsAttack(2500,2800)) .. "/" .. tostring(c:IsAttack(2500,2600)) .. "/" .. tostring(c:IsAttack({2500,2800})) .. "/" .. tostring(c:IsBaseAttack(2400,2500)) .. "/" .. tostring(c:IsDefense(2100,1700)) .. "/" .. tostring(c:IsDefense({2100,1700})) .. "/" .. tostring(c:IsBaseDefense(1700,2100)) .. "/" .. tostring(c:IsTextDefense(2100,1700)) .. "/" .. tostring(c:IsLevel(6,7)) .. "/" .. tostring(c:IsLevel({6,7})))
      Debug.Message("stat comparisons " .. tostring(c:IsAttackAbove(2400)) .. "/" .. tostring(c:IsAttackBelow(2600)) .. "/" .. tostring(c:IsDefenseAbove(2200)) .. "/" .. tostring(c:IsDefenseBelow(2200)) .. "/" .. tostring(c:IsLevelAbove(6)) .. "/" .. tostring(c:IsLevelBelow(6)))
      Debug.Message("original stat comparisons " .. tostring(c:IsOriginalAttack(2500,2400)) .. "/" .. tostring(c:IsOriginalAttackAbove(2400)) .. "/" .. tostring(c:IsOriginalAttackBelow(2600)) .. "/" .. tostring(c:IsOriginalDefense(2100,1700)) .. "/" .. tostring(c:IsOriginalDefenseAbove(2200)) .. "/" .. tostring(c:IsOriginalDefenseBelow(2200)) .. "/" .. tostring(c:IsOriginalLevel(6,7)) .. "/" .. tostring(c:IsOriginalLevelAbove(6)) .. "/" .. tostring(c:IsOriginalLevelBelow(6)))
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsCode(900,100)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(900,100)) .. "/" .. tostring(c:IsOriginalCode(100)) .. "/" .. tostring(c:IsSummonCode(nil,0,0,{900,100})) .. "/" .. tostring(c:IsSummonCode(nil,0,0,900,100)) .. "/" .. tostring(c:IsSummonCode(nil,0,0,{901,902})))
      Debug.Message("not code checks " .. tostring(c:IsNotCode(900)) .. "/" .. tostring(c:IsNotCode(900,100)) .. "/" .. tostring(c:IsNotCode(901)))
      Debug.Message("code rule checks " .. c:GetOriginalCodeRule() .. "/" .. tostring(c:IsOriginalCodeRule(900)) .. "/" .. tostring(c:IsOriginalCodeRule(900,100)) .. "/" .. tostring(c:IsOriginalCodeRule(100)))
      Debug.Message("set checks " .. tostring(c:IsSetCard(0x123)) .. "/" .. tostring(c:IsSetCard({0x456,0x123})) .. "/" .. tostring(c:IsSetCard(0x456,0x123)) .. "/" .. tostring(c:IsOriginalSetCard(0x123)) .. "/" .. tostring(c:IsOriginalSetCard({0x456,0x123})) .. "/" .. tostring(c:IsOriginalSetCard(0x456,0x123)) .. "/" .. tostring(c:IsOriginalSetCard(0x456)) .. "/" .. tostring(c:IsNotSetCard(0x123)) .. "/" .. tostring(c:IsNotSetCard({0x123,0x456})) .. "/" .. tostring(c:IsNotSetCard(0x456,0x789)) .. "/" .. tostring(c:IsNotSetCard(0x456)))
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
      Debug.Message("type varargs " .. tostring(c:IsType(TYPE_SPELL,TYPE_EFFECT)) .. "/" .. tostring(c:IsType({TYPE_SPELL,TYPE_EFFECT})) .. "/" .. tostring(c:IsType(TYPE_SPELL,TYPE_TRAP)) .. "/" .. tostring(c:IsOriginalType(TYPE_SPELL,TYPE_EFFECT)) .. "/" .. tostring(c:IsOriginalType({TYPE_SPELL,TYPE_EFFECT})) .. "/" .. tostring(c:IsNotType(TYPE_SPELL,TYPE_TRAP)) .. "/" .. tostring(c:IsNotType({TYPE_SPELL,TYPE_TRAP})) .. "/" .. tostring(c:IsNotType(TYPE_SPELL,TYPE_EFFECT)) .. "/" .. tostring(c:IsNotOriginalType(TYPE_SPELL,TYPE_TRAP)) .. "/" .. tostring(c:IsNotOriginalType({TYPE_SPELL,TYPE_TRAP})) .. "/" .. tostring(c:IsNotOriginalType(TYPE_SPELL,TYPE_EFFECT)))
      Debug.Message("named type predicates " .. tostring(ritual:IsRitualMonster()) .. "/" .. tostring(c:IsRitualMonster()) .. "/" .. tostring(synchro:IsSynchroMonster()) .. "/" .. tostring(c:IsSynchroMonster()) .. "/" .. tostring(xyz:IsXyzMonster()) .. "/" .. tostring(c:IsXyzMonster()) .. "/" .. tostring(pendulum:IsPendulumMonster()) .. "/" .. tostring(c:IsPendulumMonster()) .. "/" .. tostring(normal:IsNonEffectMonster()) .. "/" .. tostring(c:IsNonEffectMonster()) .. "/" .. tostring(c:IsEffectMonster()) .. "/" .. tostring(normal:IsEffectMonster()) .. "/" .. tostring(c:IsForbidden()))
      Debug.Message("rank " .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:HasRank()) .. "/" .. tostring(normal:HasRank()) .. "/" .. tostring(xyz:IsRank(4)) .. "/" .. tostring(xyz:IsOriginalRank(4)) .. "/" .. zero_rank:GetRank() .. "/" .. tostring(zero_rank:HasRank()))
      Debug.Message("rank varargs " .. tostring(xyz:IsRank(3,4)) .. "/" .. tostring(xyz:IsRank({3,4})) .. "/" .. tostring(xyz:IsRank(2,3)) .. "/" .. tostring(xyz:IsOriginalRank(3,4)) .. "/" .. tostring(xyz:IsOriginalRank({3,4})))
      Debug.Message("rank level gates " .. tostring(xyz:IsOriginalLevel(4)) .. "/" .. tostring(normal:IsOriginalRank(0)))
      Debug.Message("rank link levels " .. xyz:GetLevel() .. "/" .. xyz:GetOriginalLevel() .. "/" .. link:GetLevel() .. "/" .. link:GetOriginalLevel())
      Debug.Message("spirit predicate " .. tostring(spirit:IsSpirit()) .. "/" .. tostring(c:IsSpirit()))
      Debug.Message("plus minus predicate " .. tostring(plus:IsPlusOrMinus()) .. "/" .. tostring(minus:IsPlusOrMinus()) .. "/" .. tostring(plus_minus:IsPlusOrMinus()) .. "/" .. tostring(c:IsPlusOrMinus()))
      Debug.Message("rank comparisons " .. tostring(xyz:IsRankAbove(3)) .. "/" .. tostring(xyz:IsRankBelow(3)) .. "/" .. tostring(xyz:IsOriginalRankAbove(4)) .. "/" .. tostring(xyz:IsOriginalRankBelow(4)))
      Debug.Message("rank update " .. xyz:UpdateRank(-10, RESETS_STANDARD_PHASE_END) .. "/" .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:IsRank(1)) .. "/" .. tostring(xyz:IsRankBelow(2)))
      Debug.Message("link " .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. link:GetLinkMarker() .. "/" .. tostring(link:IsLink(2)) .. "/" .. tostring(link:IsOriginalLink(2)) .. "/" .. tostring(link:IsLinkMonster()) .. "/" .. tostring(c:IsLinkMonster()) .. "/" .. tostring(link:IsLineMonster()) .. "/" .. tostring(c:IsLineMonster()))
      Debug.Message("link varargs " .. tostring(link:IsLink(1,2)) .. "/" .. tostring(link:IsLink({1,2})) .. "/" .. tostring(link:IsLink(3,4)) .. "/" .. tostring(link:IsOriginalLink(1,2)) .. "/" .. tostring(link:IsOriginalLink({1,2})))
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
      Debug.Message("race attr varargs " .. tostring(c:IsRace(RACE_DRAGON,RACE_SPELLCASTER)) .. "/" .. tostring(c:IsRace({RACE_DRAGON,RACE_SPELLCASTER})) .. "/" .. tostring(c:IsRace(RACE_DRAGON)) .. "/" .. tostring(c:IsOriginalRace(RACE_DRAGON,RACE_SPELLCASTER)) .. "/" .. tostring(c:IsNotRace(RACE_DRAGON,RACE_ZOMBIE)) .. "/" .. tostring(c:IsNotRace({RACE_DRAGON,RACE_ZOMBIE})) .. "/" .. tostring(c:IsNotRace(RACE_DRAGON,RACE_SPELLCASTER)) .. "/" .. tostring(c:IsAttribute(ATTRIBUTE_LIGHT,ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsAttribute({ATTRIBUTE_LIGHT,ATTRIBUTE_DARK})) .. "/" .. tostring(c:IsAttribute(ATTRIBUTE_LIGHT)) .. "/" .. tostring(c:IsOriginalAttribute(ATTRIBUTE_LIGHT,ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsNotAttribute(ATTRIBUTE_LIGHT,ATTRIBUTE_FIRE)) .. "/" .. tostring(c:IsNotAttribute({ATTRIBUTE_LIGHT,ATTRIBUTE_FIRE})) .. "/" .. tostring(c:IsNotAttribute(ATTRIBUTE_LIGHT,ATTRIBUTE_DARK)))
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
    expect(host.messages).toContain("stat varargs true/false/true/true/true/true/true/true/true/true");
    expect(host.messages).toContain("stat comparisons true/false/false/true/true/false");
    expect(host.messages).toContain("original stat comparisons true/true/true/true/false/true/true/true/false");
    expect(host.messages).toContain("code checks true/true/false/true/true/true/true/false");
    expect(host.messages).toContain("not code checks false/false/true");
    expect(host.messages).toContain("code rule checks 100/false/true/true");
    expect(host.messages).toContain("set checks true/true/true/true/true/true/false/false/false/true/true");
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
    expect(host.messages).toContain("type varargs true/true/false/true/true/true/true/false/true/true/false");
    expect(host.messages).toContain("named type predicates true/false/true/false/true/false/true/false/true/false/true/false/false");
    expect(host.messages).toContain("rank 4/4/true/false/true/true/0/true");
    expect(host.messages).toContain("rank varargs true/true/false/true/true");
    expect(host.messages).toContain("rank level gates false/false");
    expect(host.messages).toContain("rank link levels 0/0/0/0");
    expect(host.messages).toContain("spirit predicate true/false");
    expect(host.messages).toContain("plus minus predicate true/true/false/false");
    expect(host.messages).toContain("has level true/false/false/false/true");
    expect(host.messages).toContain("main card types 1/2/2/5");
    expect(host.messages).toContain("rank comparisons true/false/true/true");
    expect(host.messages).toContain("rank update -3/1/4/true/true");
    expect(host.messages).toContain("link 2/2/5/true/true/true/false/true/false");
    expect(host.messages).toContain("link varargs true/true/false/true/true");
    expect(host.messages).toContain("link stat gates false/false/false/false/false/false");
    expect(host.messages).toContain("link comparisons true/false/false/true");
    expect(host.messages).toContain("link update 3/5/2/true/true");
    expect(host.messages).toContain("ritual fixed level 5");
    expect(host.messages).toContain("ritual function level 7");
    expect(host.messages).toContain("ritual summoning level 7");
    expect(host.messages).toContain("synchro levels 4/5/8");
    expect(host.messages).toContain("level update -6/1/7/true/true");
    expect(host.messages).toContain("scale hand 3/3/8/3/8/true/true/false");
    expect(host.messages).toContain("scale pzone 0/3/true/false");
    expect(host.messages).toContain("scale update -2/1/1/6/3/8/true");
    expect(host.messages).toContain("race 2 true/true");
    expect(host.messages).toContain("not race false/true");
    expect(host.messages).toContain("attribute 32 true/true");
    expect(host.messages).toContain("race attr varargs true/true/false/true/true/true/false/true/true/false/true/true/true/false");
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

  it("keeps stat mutation helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Stat Source", kind: "monster", typeFlags: 0x21, attack: 2500, defense: 2100, level: 7, race: 0x2, attribute: 0x20 },
      { code: "300", name: "Ended Rank Source", kind: "extra", typeFlags: 0x8000001, level: 4 },
      { code: "400", name: "Ended Link Source", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0x5 },
      { code: "901", name: "Ended Pendulum Source", kind: "monster", typeFlags: 0x1000021, level: 4, leftScale: 3, rightScale: 8 },
    ];
    const session = createDuel({ seed: 202, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "901"], extra: ["300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local pendulum=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,901),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local xyz=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_EXTRA,0,nil):GetFirst()
      local link=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,400),0,LOCATION_EXTRA,0,nil):GetFirst()
      Duel.MoveToField(pendulum,0,0,LOCATION_PZONE,POS_FACEUP,true,1)
      c:UpdateAttack(300,RESETS_STANDARD_PHASE_END)
      c:UpdateDefense(-400,RESETS_STANDARD_PHASE_END)
      c:UpdateLevel(-20,RESETS_STANDARD_PHASE_END)
      xyz:UpdateRank(-10,RESETS_STANDARD_PHASE_END)
      link:UpdateLink(3,RESETS_STANDARD_PHASE_END)
      pendulum:UpdateScale(-10,RESETS_STANDARD_PHASE_END)
      c:AssumeProperty(ASSUME_CODE,999)
      Duel.Win(0,WIN_REASON_EXODIA)
      Debug.Message("attack ended " .. c:UpdateAttack(300,RESETS_STANDARD_PHASE_END) .. "/" .. c:GetAttack())
      Debug.Message("defense ended " .. c:UpdateDefense(300,RESETS_STANDARD_PHASE_END) .. "/" .. c:GetDefense())
      Debug.Message("level ended " .. c:UpdateLevel(3,RESETS_STANDARD_PHASE_END) .. "/" .. c:GetLevel())
      Debug.Message("rank ended " .. xyz:UpdateRank(3,RESETS_STANDARD_PHASE_END) .. "/" .. xyz:GetRank())
      Debug.Message("link ended " .. link:UpdateLink(3,RESETS_STANDARD_PHASE_END) .. "/" .. link:GetLink())
      Debug.Message("scale ended " .. pendulum:UpdateScale(3,RESETS_STANDARD_PHASE_END) .. "/" .. pendulum:GetScale())
      c:AssumeProperty(ASSUME_CODE,888)
      Debug.Message("assume ended " .. c:GetCode())
      `,
      "ended-stat-noop.lua",
    );
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toEqual([
      "attack ended 0/2800",
      "defense ended 0/1700",
      "level ended 0/1",
      "rank ended 0/1",
      "link ended 0/5",
      "scale ended 0/1",
      "assume ended 999",
    ]);
    expect(session.state.status).toBe("ended");
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "levelChanged")).toHaveLength(1);
  });

});
