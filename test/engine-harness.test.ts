import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness scaffolding", () => {
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
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(100)))
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local link = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("rank " .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:IsRank(4)))
      Debug.Message("link " .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. link:GetLinkMarker() .. "/" .. tostring(link:IsLink(2)))
      Debug.Message("race " .. c:GetRace() .. " " .. tostring(c:IsRace(RACE_SPELLCASTER)))
      Debug.Message("attribute " .. c:GetAttribute() .. " " .. tostring(c:IsAttribute(ATTRIBUTE_DARK)))
      Debug.Message("spell count " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, nil))
      `,
      "card-stats.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("type 33");
    expect(host.messages).toContain("stats 2500/2100/7");
    expect(host.messages).toContain("stat predicates true/true/true");
    expect(host.messages).toContain("code checks true/false/true");
    expect(host.messages).toContain("rank 4/4/true");
    expect(host.messages).toContain("link 2/2/5/true");
    expect(host.messages).toContain("race 2 true");
    expect(host.messages).toContain("attribute 32 true");
    expect(host.messages).toContain("spell count 1");
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
      local sorted = Group.FromCards(c300, c100, c200)
      sorted:Sort(function(a,b) return a:GetAttack()<b:GetAttack() end)
      Debug.Message("sorted asc " .. sorted:GetFirst():GetCode() .. "/" .. sorted:GetNext():GetCode() .. "/" .. sorted:GetNext():GetCode())
      local sorted_desc = Group.FromCards(c100, c200, c300)
      sorted_desc:Sort(function(a,b,desc) if desc then return a:GetAttack()>b:GetAttack() end return a:GetAttack()<b:GetAttack() end, true)
      Debug.Message("sorted desc " .. sorted_desc:GetFirst():GetCode() .. "/" .. sorted_desc:GetNext():GetCode() .. "/" .. sorted_desc:GetNext():GetCode())
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
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      Debug.Message("sum exact " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Debug.Message("sum miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 4500, 2, 2)))
      Debug.Message("sum greater " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 3500, 2, 2)))
      Debug.Message("sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 5500, 2, 2)))
      local sum_selected = all:SelectWithSumEqual(0, Card.GetAttack, 3000, 2, 2)
      Debug.Message("sum selected " .. sum_selected:GetCount())
      local sum_greater_selected = all:SelectWithSumGreater(0, Card.GetAttack, 3500, 2, 2)
      Debug.Message("sum greater selected " .. sum_greater_selected:GetCount())
      Duel.SetSelectedCard(c300)
      Debug.Message("forced sum exact miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Duel.SetSelectedCard(c100)
      Debug.Message("forced sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 4500, 2, 2)))
      Duel.SetSelectedCard(c200)
      local forced_sum = all:SelectWithSumGreater(0, Card.GetAttack, 4500, 2, 2)
      Debug.Message("forced sum greater selected " .. forced_sum:GetCount() .. " " .. tostring(forced_sum:IsContains(c200)))
      Duel.SetSelectedCard(nil)
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
    expect(host.messages).toContain("sorted asc 100/200/300");
    expect(host.messages).toContain("sorted desc 300/200/100");
    expect(host.messages).toContain("select unselect add 200");
    expect(host.messages).toContain("select unselect stop true");
    expect(host.messages).toContain("select unselect unbounded 200");
    expect(host.messages).toContain("exists high true");
    expect(host.messages).toContain("filter group excluded 2 false");
    expect(host.messages).toContain("filter count alias 2");
    expect(host.messages).toContain("exists group excluded false");
    expect(host.messages).toContain("exists group remainder true");
    expect(host.messages).toContain("class count 2");
    expect(host.messages).toContain("sum exact true");
    expect(host.messages).toContain("sum miss false");
    expect(host.messages).toContain("sum greater true");
    expect(host.messages).toContain("sum greater miss false");
    expect(host.messages).toContain("sum selected 2");
    expect(host.messages).toContain("sum greater selected 2");
    expect(host.messages).toContain("forced sum exact miss false");
    expect(host.messages).toContain("forced sum greater miss false");
    expect(host.messages).toContain("forced sum greater selected 2 true");
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

  it("stores Lua effect metadata setters on registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Metadata Source", kind: "monster" }];
    const session = createDuel({ seed: 16, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetDescription(1234)
        e:SetCategory(CATEGORY_DRAW + CATEGORY_SEARCH)
        e:SetProperty(EFFECT_FLAG_CARD_TARGET + EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(LOCATION_MZONE, LOCATION_GRAVE)
        e:SetHintTiming(TIMING_END_PHASE, TIMING_MAIN_END)
        e:SetCountLimit(2, 987)
        e:SetReset(RESET_EVENT + RESETS_STANDARD, 1)
        e:SetCondition(function(e,c) return c:IsCode(100) end)
        e:SetCost(function(e,c) return true end)
        e:SetTarget(function(e,c) return true end)
        e:SetOperation(function(e,c) Debug.Message("metadata operation") end)
        local condition=e:GetCondition()
        local cost=e:GetCost()
        local target=e:GetTarget()
        local operation=e:GetOperation()
        Debug.Message("effect predicates " .. tostring(e:IsHasType(EFFECT_TYPE_IGNITION)) .. "/" .. tostring(e:IsHasCategory(CATEGORY_DRAW)) .. "/" .. tostring(e:IsHasProperty(EFFECT_FLAG_CARD_TARGET)))
        Debug.Message("effect callbacks " .. tostring(condition(e,c)) .. "/" .. tostring(cost(e,c)) .. "/" .. tostring(target(e,c)) .. "/" .. tostring(operation ~= nil))
        e:SetValue(function(e,c) return c:GetCode()+7 end)
        local value_fn=e:GetValue()
        Debug.Message("effect value function " .. value_fn(e,c))
        e:SetValue(2500)
        local own_range,opponent_range=e:GetTargetRange()
        local limit,limit_code=e:GetCountLimit()
        local reset,reset_count=e:GetReset()
        Debug.Message("effect getters " .. e:GetType() .. "/" .. e:GetCode() .. "/" .. e:GetDescription() .. "/" .. e:GetCategory() .. "/" .. e:GetProperty() .. "/" .. e:GetRange())
        Debug.Message("effect target range " .. own_range .. "/" .. opponent_range)
        Debug.Message("effect count reset " .. limit .. "/" .. limit_code .. "/" .. reset .. "/" .. reset_count)
        Debug.Message("effect value number " .. e:GetValue())
        c:RegisterEffect(e)
      end
      `,
      "effect-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("EFFECT_TYPE_SINGLE")).toBe(0x1);
    expect(host.getGlobalNumber("EFFECT_TYPE_IGNITION")).toBe(0x40);
    expect(host.getGlobalNumber("EFFECT_TYPE_TRIGGER_O")).toBe(0x80);
    expect(host.getGlobalNumber("EFFECT_TYPE_CONTINUOUS")).toBe(0x800);
    expect(host.getGlobalNumber("EFFECT_SPSUMMON_CONDITION")).toBe(30);
    expect(host.getGlobalNumber("EFFECT_SPSUMMON_PROC")).toBe(34);
    expect(host.getGlobalNumber("EFFECT_DISABLE")).toBe(2);
    expect(host.getGlobalNumber("EFFECT_CANNOT_SPECIAL_SUMMON")).toBe(22);
    expect(host.getGlobalNumber("EFFECT_TO_GRAVE_REDIRECT")).toBe(63);
    expect(host.getGlobalNumber("EFFECT_SET_ATTACK")).toBe(101);
    expect(host.getGlobalNumber("EFFECT_CHANGE_CODE")).toBe(114);
    expect(host.getGlobalNumber("EFFECT_CHANGE_LEVEL")).toBe(131);
    expect(host.getGlobalNumber("EFFECT_DOUBLE_TRIBUTE")).toBe(150);
    expect(host.getGlobalNumber("EFFECT_PIERCE")).toBe(203);
    expect(host.getGlobalNumber("EFFECT_FUSION_SUBSTITUTE")).toBe(234);
    expect(host.getGlobalNumber("EFFECT_DISABLE_FIELD")).toBe(260);
    expect(host.getGlobalNumber("EFFECT_HAND_LIMIT")).toBe(270);
    expect(host.getGlobalNumber("EFFECT_CHANGE_LINK")).toBe(421);
    expect(host.getGlobalNumber("CATEGORY_DISABLE")).toBe(0x4000);
    expect(host.getGlobalNumber("CATEGORY_NEGATE")).toBe(0x10000000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_STEP")).toBe(0x4000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_CAL")).toBe(0x8000);
    expect(host.getGlobalNumber("EFFECT_FLAG_PLAYER_TARGET")).toBe(0x800);
    expect(host.getGlobalNumber("EFFECT_FLAG_IMMEDIATELY_APPLY")).toBe(0x80000000);
    expect(host.getGlobalNumber("HINT_SELECTMSG")).toBe(3);
    expect(host.getGlobalNumber("HINTMSG_TOHAND")).toBe(506);
    expect(host.getGlobalNumber("HINTMSG_TARGET")).toBe(551);
    expect(host.getGlobalNumber("PHASE_MAIN1")).toBe(0x4);
    expect(host.getGlobalNumber("PHASE_BATTLE")).toBe(0x80);
    expect(host.getGlobalNumber("EVENT_SUMMON_SUCCESS")).toBe(1100);
    expect(host.getGlobalNumber("EVENT_TO_GRAVE")).toBe(1014);
    expect(host.getGlobalNumber("EVENT_CHAINING")).toBe(1027);
    expect(host.getGlobalNumber("RESETS_STANDARD")).toBe(0x1fe0000);
    expect(host.getGlobalNumber("RESET_PHASE")).toBe(0x40000000);
    expect(host.getGlobalNumber("RESET_CHAIN")).toBe(0x80000000);
    expect(host.getGlobalNumber("REASON_LINK")).toBe(0x10000000);
    expect(host.getGlobalNumber("REASON_DRAW")).toBe(0x2000000);
    expect(host.registerInitialEffects()).toBe(2);
    expect(host.messages).toContain("effect predicates true/true/true");
    expect(host.messages).toContain("effect callbacks true/true/true/true");
    expect(host.messages).toContain("effect value function 107");
    expect(host.messages).toContain("effect getters 64/1100/1234/196608/65552/2");
    expect(host.messages).toContain("effect target range 4/16");
    expect(host.messages).toContain("effect count reset 2/987/33427456/1");
    expect(host.messages).toContain("effect value number 2500");
    expect(session.state.effects[0]).toMatchObject({
      registryKey: "lua:100:lua-1-1100",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      description: 1234,
      category: 0x30000,
      property: 0x10010,
      targetRange: [0x04, 0x10],
      hintTiming: [0x20, 0x4],
      countLimit: 2,
      countLimitCode: 987,
      reset: { flags: 0x1fe1000, count: 1 },
    });
    expect(serializeDuel(session).state.effects[0]).toMatchObject({
      id: "lua-1-1100",
      registryKey: "lua:100:lua-1-1100",
      sourceUid: session.state.effects[0]?.sourceUid,
    });
  });

  it("lets Lua effects clone metadata and override callbacks independently", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Clone Source", kind: "monster" },
      { code: "200", name: "Other Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 27, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetDescription(111)
        e:SetLabel(5)
        e:SetValue(10)
        e:SetOperation(function(e,c)
          Debug.Message("base op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        local e2=e:Clone()
        Debug.Message("clone initial " .. e2:GetDescription() .. "/" .. e2:GetLabel() .. "/" .. e2:GetValue() .. "/" .. e2:GetRange() .. "/" .. e2:GetOwner():GetCode() .. "/" .. e2:GetActivateLocation() .. "/" .. e2:GetActivateSequence())
        e2:SetDescription(222)
        e2:SetLabel(9)
        e2:SetValue(20)
        e2:SetOperation(function(e,c)
          Debug.Message("clone op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        c:RegisterEffect(e)
        c:RegisterEffect(e2)
      end
      `,
      "effect-clone.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("clone initial 111/5/10/2/100/2/0");
    expect(session.state.effects).toHaveLength(2);
    expect(session.state.effects[0]).toMatchObject({ description: 111, range: ["hand"], registryKey: "lua:100:lua-1" });
    expect(session.state.effects[1]).toMatchObject({ description: 222, range: ["hand"], registryKey: "lua:100:lua-2" });

    const baseAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[0]?.id);
    expect(baseAction).toBeDefined();
    expect(applyResponse(session, baseAction!).ok).toBe(true);
    const cloneAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[1]?.id);
    expect(cloneAction).toBeDefined();
    expect(applyResponse(session, cloneAction!).ok).toBe(true);

    expect(host.messages).toContain("base op 111/5/10/2/0");
    expect(host.messages).toContain("clone op 222/9/20/2/0");
  });

  it("stores Lua effect owner player metadata and deletes registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Lifecycle Source", kind: "monster" }];
    const session = createDuel({ seed: 28, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOwnerPlayer(1)
        Debug.Message("owner player " .. e:GetOwnerPlayer())
        c:RegisterEffect(e)
        local e2=e:Clone()
        e2:SetOwnerPlayer(0)
        e2:SetOperation(function(e,c)
          Debug.Message("deleted clone should not resolve")
        end)
        c:RegisterEffect(e2)
        Debug.Message("clone owner " .. e2:GetOwnerPlayer())
        e2:Delete()
      end
      `,
      "effect-lifecycle.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("owner player 1");
    expect(host.messages).toContain("clone owner 0");
    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ controller: 1, ownerPlayer: 1 });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("passes chk values to upstream-style Lua cost and target callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Check Source", kind: "monster" },
      { code: "200", name: "Check Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 29, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("cost check " .. tp)
            return true
          end
          Debug.Message("cost activate " .. chk)
          return true
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("target check " .. tp)
            return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
          end
          Debug.Message("target activate " .. chk)
          local g=Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), tp, 0)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation target " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-chk.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(host.messages).toContain("cost check 0");
    expect(host.messages).toContain("target check 0");
    expect(host.messages).not.toContain("target activate 0");
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("cost activate 1");
    expect(host.messages).toContain("target activate 1");
    expect(host.messages).toContain("operation target 200");
  });

  it("shares Lua keyed count limits across effect copies", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Source", kind: "monster" }];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1, 700)
        e:SetOperation(function(e,c)
          Debug.Message("used " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "keyed-count-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const firstAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(firstAction).toBeDefined();
    applyResponse(session, firstAction!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("used 100");
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("lets Lua effects pass labels and label objects between callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Label Source", kind: "monster" },
      { code: "200", name: "Label Object", kind: "monster" },
    ];
    const session = createDuel({ seed: 17, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetLabel(7)
        e:SetTarget(function(e,c)
          Debug.Message("target label " .. e:GetLabel())
          e:SetLabel(e:GetLabel()+1)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          e:SetLabelObject(g)
          return true
        end)
        e:SetOperation(function(e,c)
          local g=e:GetLabelObject()
          Debug.Message("operation label " .. e:GetLabel())
          Debug.Message("label object count " .. g:GetCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("target label 7");
    expect(host.messages).toContain("operation label 8");
    expect(host.messages).toContain("label object count 1");
  });

  it("lets Lua effects share operation info between target and operation callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Operation Source", kind: "monster" },
      { code: "200", name: "Operation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Duel.Hint(HINT_SELECTMSG, 0, HINTMSG_TOHAND)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          Duel.SetPossibleOperationInfo(0, CATEGORY_DRAW, nil, 0, 1, 2)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,cat,g,count,p,param=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info " .. tostring(ok) .. "/" .. cat .. "/" .. g:GetCount() .. "/" .. count .. "/" .. p .. "/" .. param)
          local possible,pcat,pg,pcount,pp,pparam=Duel.GetPossibleOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible operation info " .. tostring(possible) .. "/" .. pcat .. "/" .. pg:GetCount() .. "/" .. pcount .. "/" .. pp .. "/" .. pparam)
          local committed_draw=Duel.GetOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible separate " .. tostring(committed_draw))
          Debug.Message("target relates " .. tostring(Duel.GetFirstTarget():IsRelateToEffect(e)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("operation info true/8/1/1/0/0");
    expect(host.messages).toContain("possible operation info true/65536/0/0/1/2");
    expect(host.messages).toContain("possible separate false");
    expect(host.messages).toContain("target relates true");
  });

  it("lets Lua effects seed target cards without selecting", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Manual Target Source", kind: "monster" },
      { code: "200", name: "Manual Target A", kind: "monster" },
      { code: "300", name: "Manual Target B", kind: "monster" },
    ];
    const session = createDuel({ seed: 48, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(200) or tc:IsCode(300) end, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("manual target set " .. Duel.GetTargetCards():GetCount())
          local replacement=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(replacement)
          Debug.Message("manual target replaced " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Duel.ClearTargetCard()
          Debug.Message("manual target clear alias " .. Duel.GetTargetCards():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          Duel.SetTargetCard(nil)
          Debug.Message("manual target cleared " .. Duel.GetTargetCards():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local tg=Duel.GetTargetCards()
          Debug.Message("manual target cards " .. tg:GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "manual-target-card.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("manual target set 2");
    expect(host.messages).toContain("manual target replaced 1/300");
    expect(host.messages).toContain("manual target clear alias 0/true");
    expect(host.messages).toContain("manual target cleared 0/true");
    expect(host.messages.join("\n")).toContain("manual target cards 2/");
  });

  it("lets Lua quick effects inspect pending chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Source", kind: "monster", alias: "101", level: 4, attack: 1800, defense: 1200, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Chain Target", kind: "monster" },
      { code: "400", name: "Chain Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 24, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local te,tp,loc,tc,tg=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_EFFECT, CHAININFO_TRIGGERING_PLAYER, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_CARD, CHAININFO_TARGET_CARDS)
          local ok,handler=pcall(function() return te:GetHandler() end)
          Debug.Message("handler ok " .. tostring(ok) .. "/" .. tostring(handler ~= nil))
          if not ok then return false end
          Debug.Message("chain solving window " .. tostring(Duel.IsChainSolving()))
          Debug.Message("chain info " .. tp .. "/" .. loc .. "/" .. tc:GetCode() .. "/" .. tg:GetCount() .. "/" .. handler:GetCode())
          Debug.Message("chain count player " .. Duel.GetChainCount() .. "/" .. Duel.GetChainPlayer(1))
          local pos,code,code2,level,rank,attr,race,atk,def=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_POSITION, CHAININFO_TRIGGERING_CODE, CHAININFO_TRIGGERING_CODE2, CHAININFO_TRIGGERING_LEVEL, CHAININFO_TRIGGERING_RANK, CHAININFO_TRIGGERING_ATTRIBUTE, CHAININFO_TRIGGERING_RACE, CHAININFO_TRIGGERING_ATTACK, CHAININFO_TRIGGERING_DEFENSE)
          Debug.Message("chain stats " .. pos .. "/" .. code .. "/" .. code2 .. "/" .. level .. "/" .. rank .. "/" .. attr .. "/" .. race .. "/" .. atk .. "/" .. def)
          local chain_type,chain_exttype=Duel.GetChainInfo(1, CHAININFO_TYPE, CHAININFO_EXTTYPE)
          Debug.Message("chain type " .. chain_type .. "/" .. chain_exttype)
          local chain_id,disable_reason,disable_player=Duel.GetChainInfo(1, CHAININFO_CHAIN_ID, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("chain id disable " .. tostring(chain_id>0) .. "/" .. disable_reason .. "/" .. disable_player)
          local mat=Duel.GetChainMaterial(1)
          Debug.Message("chain material " .. mat:GetCount() .. "/" .. mat:GetFirst():GetCode())
          Debug.Message("chain target fallback " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Debug.Message("chain target checks " .. tostring(Duel.CheckChainTarget(1,tg:GetFirst())) .. "/" .. tostring(Duel.CheckChainTarget(1,e:GetHandler())))
          Debug.Message("chain unique " .. tostring(Duel.CheckChainUniqueness()))
          return tp==0 and tc:IsCode(100) and tg:GetCount()==1 and handler:IsCode(100)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("chain solving window false");
    expect(host.messages).toContain("chain info 0/2/100/1/100");
    expect(host.messages).toContain("chain count player 1/0");
    expect(host.messages).toContain("chain stats 0/100/101/4/0/32/2/1800/1200");
    expect(host.messages).toContain("chain type 64/1");
    expect(host.messages).toContain("chain id disable true/0/0");
    expect(host.messages).toContain("chain material 1/200");
    expect(host.messages).toContain("chain target fallback 1/200");
    expect(host.messages).toContain("chain target checks true/false");
    expect(host.messages).toContain("chain unique true");
    expect(host.messages).toContain("quick resolved");
    expect(host.messages).toContain("source resolved");
  });

  it("lets Lua effects block immediate chain responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Limit Source", kind: "monster" },
      { code: "400", name: "Blocked Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Duel.SetChainLimit(aux.FALSE)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("limit source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,c)
          Debug.Message("blocked quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    expect(host.messages).toContain("limit source resolved");
    expect(host.messages).not.toContain("blocked quick resolved");
  });

  it("keeps Lua chain limits until the chain resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Limit Source", kind: "monster" },
      { code: "400", name: "Allowed Quick", kind: "monster" },
      { code: "500", name: "Blocked Chain Back", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Duel.SetChainLimitTillChainEnd(function(te,rp,tp) return rp==1 end)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("persistent source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed quick resolved") end)
        c:RegisterEffect(e)
      end
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("chain back resolved") end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit-persistent.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const allowed = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(allowed).toBeDefined();
    expect(applyResponse(session, allowed!).ok).toBe(true);
    expect(host.messages).toContain("allowed quick resolved");
    expect(host.messages).toContain("persistent source resolved");
    expect(host.messages).not.toContain("chain back resolved");
  });

  it("detects duplicate card codes in the current Lua chain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Duplicate Chain Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate source resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_QUICK_O)
        e2:SetRange(LOCATION_HAND)
        e2:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e2:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate chain unique " .. tostring(Duel.CheckChainUniqueness()))
        end)
        c:RegisterEffect(e2)
      end
      `,
      "duplicate-chain.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    applyResponse(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("duplicate chain unique false");
    expect(host.messages).toContain("duplicate source resolved");
  });

  it("lets Lua effects carry target player and parameter metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Metadata Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetPlayer(1-tp)
          Duel.SetTargetParam(700)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("target metadata solving " .. tostring(Duel.IsChainSolving()))
          Debug.Message("target metadata chain player " .. Duel.GetChainPlayer(0))
          local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata " .. p .. "/" .. d)
          Duel.ChangeTargetPlayer(0,tp)
          Duel.ChangeTargetParam(0,900)
          local p2,d2=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata changed " .. p2 .. "/" .. d2)
        end)
        c:RegisterEffect(e)
      end
      `,
      "target-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    expect(host.messages).toContain("target metadata solving true");
    expect(host.messages).toContain("target metadata chain player 0");
    expect(host.messages).toContain("target metadata 1/700");
    expect(host.messages).toContain("target metadata changed 0/900");
  });

  it("lets Lua quick effects negate pending chain links", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Source", kind: "monster" },
      { code: "400", name: "Negating Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 25, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0 and Duel.IsChainNegatable(1) and Duel.IsChainDisablable(1)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("negatable " .. tostring(Duel.IsChainNegatable(1)))
          Debug.Message("disablable " .. tostring(Duel.IsChainDisablable(1)))
          local before_reason,before_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable before " .. before_reason .. "/" .. before_player)
          Debug.Message("negated " .. tostring(Duel.NegateEffect(1)))
          Debug.Message("disablable after " .. tostring(Duel.IsChainDisablable(1)))
          local after_reason,after_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable after " .. after_reason .. "/" .. after_player)
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-negate.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    expect(applyResponse(session, quickAction!).ok).toBe(true);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });

    expect(host.messages).toContain("negatable true");
    expect(host.messages).toContain("disablable true");
    expect(host.messages).toContain("disable before 0/0");
    expect(host.messages).toContain("negated true");
    expect(host.messages).toContain("disablable after false");
    expect(host.messages).toContain("disable after 64/1");
    expect(host.messages).not.toContain("source resolved");
    expect(session.state.log.some((entry) => entry.action === "chainNegated")).toBe(true);
  });

  it("passes upstream-style Lua callback arguments to trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summoned Event", kind: "monster" },
      { code: "400", name: "Argument Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 26, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local ec=eg:GetFirst()
          Debug.Message("condition args " .. tp .. "/" .. eg:GetCount() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re==nil) .. "/" .. r .. "/" .. rp .. "/" .. ec:GetCode())
          return tp==1 and eg:GetCount()==1 and ep==0 and ec:IsCode(100)
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp)
          local handler=e:GetHandler()
          Debug.Message("target args " .. tp .. "/" .. handler:GetCode() .. "/" .. eg:GetFirst():GetCode())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation args " .. tp .. "/" .. eg:GetFirst():GetCode() .. "/" .. tostring(re==nil))
          local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
          Debug.Message("chain event " .. ceg:GetCount() .. "/" .. cep .. "/" .. cev .. "/" .. tostring(cre==nil) .. "/" .. cr .. "/" .. crp .. "/" .. ceg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "callback-args.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(host.messages).toContain("condition args 1/1/0/0/true/16/0/100");
    expect(host.messages).toContain("target args 1/400/100");
    expect(host.messages).toContain("operation args 1/100/true");
    expect(host.messages).toContain("chain event 1/0/0/true/16/0/100");
  });

  it("lets Lua effects register, read, and reset duel and card flags", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Debug.Message("duel flag register " .. Duel.RegisterFlagEffect(0, 901, RESET_EVENT, 0, 3))
          Debug.Message("card flag register " .. c:RegisterFlagEffect(902, RESET_EVENT, 0, 4))
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
          Debug.Message("duel flag after " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag after " .. c:GetFlagEffect(902))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-effects.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("duel flag register 1");
    expect(host.messages).toContain("card flag register 1");
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster" },
      { code: "200", name: "Aux B", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      Debug.Message("target exists " .. tostring(Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, nil)))
      Debug.Message("target count " .. Duel.GetTargetCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("true count 2");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 1");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 2");
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Prompt Source", kind: "monster" }];
    const session = createDuel({ seed: 30, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local option=Duel.SelectOption(0, 101, 102, 103)
      local yes=Duel.SelectYesNo(0, 201)
      local number=Duel.AnnounceNumber(0, 4, 7, 9)
      local card=Duel.AnnounceCard(0, 100, 200)
      local kind=Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local race=Duel.AnnounceRace(0, RACE_WARRIOR, RACE_SPELLCASTER)
      local attribute=Duel.AnnounceAttribute(0, ATTRIBUTE_LIGHT, ATTRIBUTE_DARK)
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      Debug.Message("prompt option " .. option .. "/" .. tostring(yes))
      Debug.Message("prompt announce " .. number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("prompt option 0/true");
    expect(host.messages).toContain("prompt announce 4/100/1/1/16");
    expect(host.messages).toContain("prompt zones 1/768/31/96");
  });

  it("exposes summon type metadata to Lua card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon A", kind: "monster" },
      { code: "300", name: "Summon B", kind: "monster" },
      { code: "900", name: "Summon Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normalUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normalUid);
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const normalResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. c:GetSummonType())
      Debug.Message("normal activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("normal type true/268435456");
    expect(host.messages).toContain("normal activity 1/1/0");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    expect(applyResponse(session, fusion!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "900")?.summonType).toBe("fusion");

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)))
      Debug.Message("fusion activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type true/true");
    expect(host.messages).toContain("fusion activity 2/1/1");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);
  });

  it("exposes card owner, controller, location, sequence, and position metadata", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "State Probe", kind: "monster", typeFlags: 0x21, attack: 1700, defense: 1300, level: 4, race: 0x2, attribute: 0x20 }];
    const session = createDuel({ seed: 20, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("card state " .. c:GetOwner() .. "/" .. tostring(c:IsOwner(0)) .. "/" .. c:GetControler() .. "/" .. c:GetLocation() .. "/" .. c:GetSequence() .. "/" .. c:GetPosition())
      Debug.Message("original meta " .. c:GetOriginalCode() .. "/" .. c:GetOriginalType() .. "/" .. c:GetOriginalLevel() .. "/" .. c:GetOriginalRace() .. "/" .. c:GetOriginalAttribute())
      Debug.Message("base stats " .. c:GetBaseAttack() .. "/" .. c:GetBaseDefense())
      Debug.Message("position checks " .. tostring(c:IsPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(c:IsControler(0)))
      Debug.Message("relation checks " .. tostring(c:IsOnField()) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsSpell()) .. "/" .. tostring(c:IsTrap()) .. "/" .. tostring(c:IsCanBeEffectTarget(nil)))
      Debug.Message("activity counts " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_FLIPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_ATTACK))
      Debug.Message("used summon legality " .. tostring(Duel.IsPlayerCanSummon(0, c)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, c)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, c)))
      Duel.SendtoGrave(c, REASON_EFFECT)
      local g = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("previous state " .. g:GetPreviousLocation() .. "/" .. g:GetPreviousControler() .. "/" .. g:GetPreviousSequence() .. "/" .. g:GetPreviousPosition())
      Debug.Message("previous position " .. tostring(g:IsPreviousPosition(POS_FACEUP_ATTACK)))
      Debug.Message("grave relation " .. tostring(g:IsOnField()) .. "/" .. tostring(g:IsMonster()))
      `,
      "card-state.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("card state 0/true/0/4/0/1");
    expect(host.messages).toContain("original meta 100/33/4/2/32");
    expect(host.messages).toContain("base stats 1700/1300");
    expect(host.messages).toContain("position checks true/true");
    expect(host.messages).toContain("relation checks true/true/false/false/true");
    expect(host.messages).toContain("activity counts 1/1/0/0/0");
    expect(host.messages).toContain("used summon legality false/false/false");
    expect(host.messages).toContain("previous state 4/0/0/1");
    expect(host.messages).toContain("previous position true");
    expect(host.messages).toContain("grave relation false/true");
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_turn = Duel.GetTurnCount()
      observed_phase = Duel.GetCurrentPhase()
      observed_turn_player = tostring(Duel.IsTurnPlayer(0))
      observed_not_turn_player = tostring(Duel.IsTurnPlayer(1))
      observed_main_phase = tostring(Duel.IsMainPhase())
      observed_battle_phase = tostring(Duel.IsBattlePhase())
      observed_damage_step = tostring(Duel.IsDamageStep())
      observed_damage_calculated = tostring(Duel.IsDamageCalculated())
      observed_normal_activity = Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON)
      observed_summon_activity = Duel.GetActivityCount(0, ACTIVITY_SUMMON)
      observed_attack_activity = Duel.GetActivityCount(0, ACTIVITY_ATTACK)
      local hand = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      observed_can_summon = tostring(Duel.IsPlayerCanSummon(0, hand))
      observed_can_mset = tostring(Duel.IsPlayerCanMSet(0, hand))
      observed_can_special = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, hand))
      observed_bad_special_position = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEDOWN_ATTACK, 0, hand))
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalNumber("observed_turn")).toBe(1);
    expect(host.getGlobalNumber("observed_phase")).toBe(0x4);
    expect(host.getGlobalString("observed_turn_player")).toBe("true");
    expect(host.getGlobalString("observed_not_turn_player")).toBe("false");
    expect(host.getGlobalString("observed_main_phase")).toBe("true");
    expect(host.getGlobalString("observed_battle_phase")).toBe("false");
    expect(host.getGlobalString("observed_damage_step")).toBe("false");
    expect(host.getGlobalString("observed_damage_calculated")).toBe("false");
    expect(host.getGlobalNumber("observed_normal_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_summon_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_attack_activity")).toBe(0);
    expect(host.getGlobalString("observed_can_summon")).toBe("true");
    expect(host.getGlobalString("observed_can_mset")).toBe("true");
    expect(host.getGlobalString("observed_can_special")).toBe("true");
    expect(host.getGlobalString("observed_bad_special_position")).toBe("false");
    expect(host.messages).toContain("lua host online");
  });
});
