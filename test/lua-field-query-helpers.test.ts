import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua field and query helpers", () => {
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

    expect(result.ok).toBe(true);
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
    const expectedTop = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, 2)
      .map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 2)
      Debug.Message("top count " .. top:GetCount())
      local first = top:GetNext()
      local second = top:GetNext()
      Debug.Message("first top " .. first:GetCode())
      Debug.Message("second top " .. second:GetCode())
      Duel.ConfirmCards(1, top)
      Debug.Message("sent top " .. Duel.SendtoHand(top, 0, REASON_EFFECT))
      Duel.ShuffleDeck(0)
      `,
      "deck-top.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("top count 2");
    expect(host.messages).toContain(`first top ${expectedTop[0]}`);
    expect(host.messages).toContain(`second top ${expectedTop[1]}`);
    expect(host.messages).toContain(`confirmed 1: ${expectedTop.join(",")}`);
    expect(host.messages).toContain("sent top 2");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && expectedTop.includes(card.code))).toHaveLength(2);
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
      Debug.Message("field count " .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK))
      Debug.Message("banished count " .. Duel.GetMatchingGroupCount(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil))
      local first = mixed:GetNext()
      local second = mixed:GetNext()
      local third = mixed:GetNext()
      local fourth = mixed:GetNext()
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
      Debug.Message("onfield count " .. Duel.GetFieldGroupCount(0, LOCATION_ONFIELD, LOCATION_ONFIELD))
      `,
      "field-groups.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("mixed count 4");
    expect(host.messages).toContain("field count 4");
    expect(host.messages).toContain("banished count 1");
    expect(host.messages).toContain("mixed codes 100,200,300,400");
    expect(host.messages).toContain("field card codes 100/400/true");
    expect(host.messages).toContain("first matching card 300");
    expect(host.messages).toContain("group excluded count 2");
    expect(host.messages).toContain("group excluded matching count 2");
    expect(host.messages).toContain("matching target alias count 2");
    expect(host.messages).toContain("matching target alias group 2");
    expect(host.messages).toContain("group excluded exists false");
    expect(host.messages).toContain("group excluded first 200");
    expect(host.messages).toContain("group excluded selected 2");
    expect(host.messages).toContain("group excluded selected too few 0");
    expect(host.messages).toContain("group excluded selected unbounded 2");
    expect(host.messages).toContain("onfield count 0");
  });

  it("lets Lua scripts read card type, stats, race, and attribute", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "900", name: "Stat Monster", kind: "monster", typeFlags: 0x21, attack: 2500, defense: 2100, level: 7, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Rank Fixture", kind: "monster", typeFlags: 0x800001, attack: 1800, defense: 1200, level: 4 },
      { code: "400", name: "Link Fixture", kind: "monster", typeFlags: 0x4000001, attack: 1500, level: 2, linkMarkers: 0x5 },
    ];
    const session = createDuel({ seed: 14, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monsters = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local c = monsters:GetFirst()
      Debug.Message("type " .. c:GetType())
      Debug.Message("stats " .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. c:GetLevel())
      Debug.Message("stat predicates " .. tostring(c:IsAttack(2500)) .. "/" .. tostring(c:IsDefense(2100)) .. "/" .. tostring(c:IsLevel(7)))
      Debug.Message("stat comparisons " .. tostring(c:IsAttackAbove(2400)) .. "/" .. tostring(c:IsAttackBelow(2600)) .. "/" .. tostring(c:IsDefenseAbove(2200)) .. "/" .. tostring(c:IsDefenseBelow(2200)) .. "/" .. tostring(c:IsLevelAbove(6)) .. "/" .. tostring(c:IsLevelBelow(6)))
      Debug.Message("original stat comparisons " .. tostring(c:IsOriginalAttack(2500)) .. "/" .. tostring(c:IsOriginalAttackAbove(2400)) .. "/" .. tostring(c:IsOriginalAttackBelow(2600)) .. "/" .. tostring(c:IsOriginalDefense(2100)) .. "/" .. tostring(c:IsOriginalDefenseAbove(2200)) .. "/" .. tostring(c:IsOriginalDefenseBelow(2200)) .. "/" .. tostring(c:IsOriginalLevelAbove(6)) .. "/" .. tostring(c:IsOriginalLevelBelow(6)))
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(100)))
      Debug.Message("code rule checks " .. c:GetOriginalCodeRule() .. "/" .. tostring(c:IsOriginalCodeRule(900)) .. "/" .. tostring(c:IsOriginalCodeRule(100)))
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local link = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("original predicates " .. tostring(c:IsOriginalType(TYPE_EFFECT)) .. "/" .. tostring(c:IsOriginalLevel(7)))
      Debug.Message("rank " .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:IsRank(4)) .. "/" .. tostring(xyz:IsOriginalRank(4)))
      Debug.Message("rank comparisons " .. tostring(xyz:IsRankAbove(3)) .. "/" .. tostring(xyz:IsRankBelow(3)) .. "/" .. tostring(xyz:IsOriginalRankAbove(4)) .. "/" .. tostring(xyz:IsOriginalRankBelow(4)))
      Debug.Message("link " .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. link:GetLinkMarker() .. "/" .. tostring(link:IsLink(2)) .. "/" .. tostring(link:IsOriginalLink(2)))
      Debug.Message("link comparisons " .. tostring(link:IsLinkAbove(2)) .. "/" .. tostring(link:IsLinkBelow(1)) .. "/" .. tostring(link:IsOriginalLinkAbove(3)) .. "/" .. tostring(link:IsOriginalLinkBelow(2)))
      Debug.Message("race " .. c:GetRace() .. " " .. tostring(c:IsRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsOriginalRace(RACE_SPELLCASTER)))
      Debug.Message("attribute " .. c:GetAttribute() .. " " .. tostring(c:IsAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsOriginalAttribute(ATTRIBUTE_DARK)))
      Debug.Message("spell count " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, nil))
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("spell material checks " .. tostring(spell:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(spell:IsCanBeRitualMaterial(nil)))
      `,
      "card-stats.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("type 33");
    expect(host.messages).toContain("stats 2500/2100/7");
    expect(host.messages).toContain("stat predicates true/true/true");
    expect(host.messages).toContain("stat comparisons true/true/false/true/true/false");
    expect(host.messages).toContain("original stat comparisons true/true/true/true/false/true/true/false");
    expect(host.messages).toContain("code checks true/false/true");
    expect(host.messages).toContain("code rule checks 100/false/true");
    expect(host.messages).toContain("original predicates true/true");
    expect(host.messages).toContain("rank 4/4/true/true");
    expect(host.messages).toContain("rank comparisons true/false/true/true");
    expect(host.messages).toContain("link 2/2/5/true/true");
    expect(host.messages).toContain("link comparisons true/false/false/true");
    expect(host.messages).toContain("race 2 true/true");
    expect(host.messages).toContain("attribute 32 true/true");
    expect(host.messages).toContain("spell count 1");
    expect(host.messages).toContain("spell material checks false/false");
  });

  it("checks Lua material predicates against an optional summon target", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Target Material A", kind: "monster", level: 4 },
      { code: "200", name: "Wrong Material", kind: "monster", level: 3 },
      { code: "300", name: "Target Tuner", kind: "monster", typeFlags: 0x1001, level: 2 },
      { code: "900", name: "Target Fusion", kind: "extra", fusionMaterials: ["101"] },
      { code: "910", name: "Target Synchro", kind: "extra", synchroMaterials: { tuner: "300", nonTuners: ["101"] } },
      { code: "920", name: "Target Xyz", kind: "extra", typeFlags: 0x800001, level: 4 },
      { code: "930", name: "Target Link", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "940", name: "Target Ritual", kind: "monster", ritualMaterials: ["101"] },
    ];
    const session = createDuel({ seed: 58, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "940"], extra: ["900", "910", "920", "930"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c300 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      local synchro = Duel.GetFieldCard(0, LOCATION_EXTRA, 1)
      local xyz = Duel.GetFieldCard(0, LOCATION_EXTRA, 2)
      local link = Duel.GetFieldCard(0, LOCATION_EXTRA, 3)
      local ritual = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 940), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion target material " .. tostring(c100:IsCanBeFusionMaterial(fusion)) .. "/" .. tostring(c200:IsCanBeFusionMaterial(fusion)))
      Debug.Message("ritual target material " .. tostring(c100:IsCanBeRitualMaterial(ritual)) .. "/" .. tostring(c200:IsCanBeRitualMaterial(ritual)))
      Debug.Message("xyz target hand material " .. tostring(c100:IsCanBeXyzMaterial(xyz)))
      Duel.SpecialSummon(c100, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c200, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Duel.SpecialSummon(c300, 0, 0, 0, 0, 0, POS_FACEUP_ATTACK)
      Debug.Message("synchro target material " .. tostring(c300:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c200:IsCanBeSynchroMaterial(synchro)))
      Debug.Message("xyz target field material " .. tostring(c100:IsCanBeXyzMaterial(xyz)) .. "/" .. tostring(c200:IsCanBeXyzMaterial(xyz)))
      Debug.Message("link target material " .. tostring(c100:IsCanBeLinkMaterial(link)) .. "/" .. tostring(link:IsCanBeLinkMaterial(link)))
      `,
      "target-material-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion target material true/false");
    expect(host.messages).toContain("ritual target material true/false");
    expect(host.messages).toContain("xyz target hand material false");
    expect(host.messages).toContain("synchro target material true/false");
    expect(host.messages).toContain("xyz target field material true/false");
    expect(host.messages).toContain("link target material true/false");
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
      { code: "100", name: "Group A", kind: "monster", attack: 1000 },
      { code: "200", name: "Group B", kind: "monster", attack: 2000 },
      { code: "300", name: "Group C", kind: "monster", attack: 3000 },
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
      Debug.Message("match all " .. tostring(all:Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1000)))
      Debug.Message("match miss " .. tostring(all:Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1500)))
      Debug.Message("match excluded " .. tostring(all:Match(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000)))
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      Debug.Message("bin class count " .. all:GetBinClassCount(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetCode()/100 or 0 end, 1500))
      Debug.Message("attack sum " .. all:GetSum(Card.GetAttack))
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
    expect(host.messages).toContain("contains alias true/false");
    expect(host.messages).toContain("merged 3 true");
    expect(host.messages).toContain("from cards 2 true");
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
    expect(host.messages).toContain("match all true");
    expect(host.messages).toContain("match miss false");
    expect(host.messages).toContain("match excluded true");
    expect(host.messages).toContain("class count 2");
    expect(host.messages).toContain("bin class count 2");
    expect(host.messages).toContain("attack sum 6000");
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
