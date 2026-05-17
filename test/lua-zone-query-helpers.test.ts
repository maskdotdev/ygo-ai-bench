import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua zone query helpers", () => {
  it("exposes EDOPro location reason constants used by zone-count overloads", () => {
    const session = createDuel({ seed: 157, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("location reason constants " .. LOCATION_REASON_TOFIELD .. "/" .. LOCATION_REASON_CONTROL .. "/" .. LOCATION_REASON_COUNT .. "/" .. LOCATION_REASON_RETURN)
      `,
      "location-reason-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("location reason constants 1/2/4/8");
  });

  it("exposes EDOPro symbolic location constants used by real scripts", () => {
    const session = createDuel({ seed: 158, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("symbolic locations " .. LOCATION_PUBLIC .. "/" .. LOCATION_ALL .. "/" .. LOCATION_STZONE .. "/" .. LOCATION_MMZONE .. "/" .. LOCATION_EMZONE .. "/" .. LOCATION_DECKBOT .. "/" .. LOCATION_DECKSHF)
      `,
      "symbolic-location-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("symbolic locations 60/1023/1024/2048/4096/65537/131073");
  });

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
      Debug.Message("combined linked zones " .. link:GetLinkedZone() .. "/" .. link_group:GetLinkedZone())
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
    expect(host.messages).toContain("combined linked zones 131074/196611");
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

  it("lets Lua scripts count only a requested monster zone mask", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Left Filler", kind: "monster" },
      { code: "200", name: "Right Filler", kind: "monster" },
      { code: "300", name: "Left Spell", kind: "spell" },
      { code: "400", name: "Right Spell", kind: "spell" },
    ];
    const session = createDuel({ seed: 156, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const left = session.state.cards.find((card) => card.code === "100");
    const right = session.state.cards.find((card) => card.code === "200");
    const leftSpell = session.state.cards.find((card) => card.code === "300");
    const rightSpell = session.state.cards.find((card) => card.code === "400");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(leftSpell).toBeDefined();
    expect(rightSpell).toBeDefined();
    moveDuelCard(session.state, left!.uid, "monsterZone", 0);
    left!.sequence = 0;
    moveDuelCard(session.state, leftSpell!.uid, "spellTrapZone", 0);
    leftSpell!.sequence = 0;

    const host = createLuaScriptHost(session);
    const open = host.loadScript(
      `
      local leftmost_zone = 1 << 0
      local rightmost_zone = 1 << 4
      Debug.Message("masked mzone open " .. Duel.GetLocationCount(0, LOCATION_MZONE, 0, nil, leftmost_zone) .. "/" .. Duel.GetLocationCount(0, LOCATION_MZONE, 0, nil, rightmost_zone))
      Debug.Message("masked ex mzone open " .. Duel.GetLocationCountFromEx(0, 0, nil, nil, leftmost_zone) .. "/" .. Duel.GetLocationCountFromEx(0, 0, nil, nil, rightmost_zone))
      Debug.Message("masked direct mzone open " .. Duel.GetMZoneCount(0, nil, 0, nil, leftmost_zone) .. "/" .. Duel.GetMZoneCount(0, nil, 0, nil, rightmost_zone))
      Debug.Message("masked szone open " .. Duel.GetLocationCount(0, LOCATION_SZONE, 0, nil, leftmost_zone) .. "/" .. Duel.GetLocationCount(0, LOCATION_SZONE, 0, nil, rightmost_zone))
      `,
      "masked-mzone-open.lua",
    );

    expect(open.ok, open.error).toBe(true);
    expect(host.messages).toContain("masked mzone open 0/1");
    expect(host.messages).toContain("masked ex mzone open 0/1");
    expect(host.messages).toContain("masked direct mzone open 0/1");
    expect(host.messages).toContain("masked szone open 0/1");

    moveDuelCard(session.state, right!.uid, "monsterZone", 0);
    right!.sequence = 4;
    moveDuelCard(session.state, rightSpell!.uid, "spellTrapZone", 0);
    rightSpell!.sequence = 4;
    const closed = host.loadScript(
      `
      local rightmost_zone = 1 << 4
      Debug.Message("masked mzone closed " .. Duel.GetLocationCount(0, LOCATION_MZONE, 0, nil, rightmost_zone))
      Debug.Message("masked ex mzone closed " .. Duel.GetLocationCountFromEx(0, 0, nil, nil, rightmost_zone))
      Debug.Message("masked direct mzone closed " .. Duel.GetMZoneCount(0, nil, 0, nil, rightmost_zone))
      Debug.Message("masked szone closed " .. Duel.GetLocationCount(0, LOCATION_SZONE, 0, nil, rightmost_zone))
      `,
      "masked-mzone-closed.lua",
    );

    expect(closed.ok, closed.error).toBe(true);
    expect(host.messages).toContain("masked mzone closed 0");
    expect(host.messages).toContain("masked ex mzone closed 0");
    expect(host.messages).toContain("masked direct mzone closed 0");
    expect(host.messages).toContain("masked szone closed 0");
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
      { code: "400", name: "Spell Zone Card", kind: "spell" },
    ];
    const session = createDuel({ seed: 155, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "400"] },
      1: { main: ["300"] },
    });
    startDuel(session);

    const main = session.state.cards.find((card) => card.code === "100");
    const extra = session.state.cards.find((card) => card.code === "200");
    const opponent = session.state.cards.find((card) => card.code === "300");
    const spell = session.state.cards.find((card) => card.code === "400");
    expect(main).toBeDefined();
    expect(extra).toBeDefined();
    expect(opponent).toBeDefined();
    expect(spell).toBeDefined();
    moveDuelCard(session.state, main!.uid, "monsterZone", 0);
    main!.sequence = 2;
    moveDuelCard(session.state, extra!.uid, "monsterZone", 0);
    extra!.sequence = 5;
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    opponent!.sequence = 4;
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);
    spell!.sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local main = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_STZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("main mzone " .. tostring(main:IsInMainMZone()) .. "/" .. tostring(main:IsInExtraMZone()) .. "/" .. tostring(main:IsInMainMZone(0)) .. "/" .. tostring(main:IsInMainMZone(1)))
      Debug.Message("extra mzone " .. tostring(extra:IsInMainMZone()) .. "/" .. tostring(extra:IsInExtraMZone()) .. "/" .. tostring(extra:IsInExtraMZone(0)) .. "/" .. tostring(extra:IsInExtraMZone(1)))
      Debug.Message("opponent main mzone " .. tostring(Card.IsInMainMZone(opponent,1)) .. "/" .. tostring(Card.IsInMainMZone(opponent,0)))
      Debug.Message("symbolic current zones " .. tostring(main:IsLocation(LOCATION_MZONE)) .. "/" .. tostring(main:IsLocation(LOCATION_MMZONE)) .. "/" .. tostring(main:IsLocation(LOCATION_EMZONE)) .. "/" .. tostring(extra:IsLocation(LOCATION_MZONE)) .. "/" .. tostring(extra:IsLocation(LOCATION_MMZONE)) .. "/" .. tostring(extra:IsLocation(LOCATION_EMZONE)) .. "/" .. tostring(spell:IsLocation(LOCATION_STZONE)) .. "/" .. tostring(spell:IsLocation(LOCATION_PUBLIC)))
      Debug.Message("symbolic group counts " .. Duel.GetMatchingGroupCount(nil,0,LOCATION_MMZONE,0,nil) .. "/" .. Duel.GetMatchingGroupCount(nil,0,LOCATION_EMZONE,0,nil) .. "/" .. Duel.GetMatchingGroupCount(nil,0,LOCATION_STZONE,0,nil) .. "/" .. Duel.GetFieldGroupCount(0,LOCATION_ALL,0))
      `,
      "main-extra-mzone.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("main mzone true/false/true/false");
    expect(host.messages).toContain("extra mzone false/true/true/false");
    expect(host.messages).toContain("opponent main mzone true/false");
    expect(host.messages).toContain("symbolic current zones true/true/false/true/false/true/true/true");
    expect(host.messages).toContain("symbolic group counts 1/1/1/3");
  });

  it("filters field and Pendulum zones symbolically in Lua field groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Zone Card", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Pendulum Zone Card", kind: "monster", typeFlags: 0x1000001, leftScale: 1, rightScale: 1 },
      { code: "300", name: "Spell Trap Zone Card", kind: "spell" },
      { code: "400", name: "Other Spell Trap Zone Card", kind: "trap" },
    ];
    const session = createDuel({ seed: 251, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const [code, sequence] of [["100", 4], ["200", 0], ["300", 2], ["400", 3]] as const) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0).sequence = sequence;
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("symbolic special zone counts " .. Duel.GetMatchingGroupCount(nil,0,LOCATION_FZONE,0,nil) .. "/" .. Duel.GetMatchingGroupCount(nil,0,LOCATION_PZONE,0,nil) .. "/" .. Duel.GetMatchingGroupCount(nil,0,LOCATION_STZONE,0,nil))
      Debug.Message("symbolic field group counts " .. Duel.GetFieldGroupCount(0,LOCATION_FZONE,0) .. "/" .. Duel.GetFieldGroupCount(0,LOCATION_PZONE,0) .. "/" .. Duel.GetFieldGroupCount(0,LOCATION_STZONE,0) .. "/" .. Duel.GetFieldGroupCount(0,LOCATION_SZONE,0))
      Debug.Message("symbolic selected codes " .. Duel.GetFieldGroup(0,LOCATION_FZONE,0):GetFirst():GetCode() .. "/" .. Duel.GetFieldGroup(0,LOCATION_PZONE,0):GetFirst():GetCode() .. "/" .. Duel.GetMatchingGroup(aux.TRUE,0,LOCATION_STZONE,0,nil):GetCount())
      `,
      "symbolic-field-pendulum-groups.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("symbolic special zone counts 1/1/2");
    expect(host.messages).toContain("symbolic field group counts 1/1/2/4");
    expect(host.messages).toContain("symbolic selected codes 100/200/2");
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

});
