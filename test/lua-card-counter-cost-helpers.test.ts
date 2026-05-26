import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua card counter and cost helpers", () => {
  it("lets Lua scripts count custom filtered activities", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Allowed Special", kind: "monster" },
      { code: "200", name: "Blocked Special", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      Duel.AddCustomActivityCounter(9700, ACTIVITY_SPSUMMON, aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("custom initial " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-setup.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.messages).toContain("custom initial 0");
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "100")!.uid, 0);

    const afterAllowed = host.loadScript(
      `
      Debug.Message("custom allowed " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-allowed.lua",
    );

    expect(afterAllowed.ok, afterAllowed.error).toBe(true);
    expect(host.messages).toContain("custom allowed 0");
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "200")!.uid, 0);

    const afterBlocked = host.loadScript(
      `
      Debug.Message("custom blocked " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-blocked.lua",
    );

    expect(afterBlocked.ok, afterBlocked.error).toBe(true);
    expect(host.messages).toContain("custom blocked 1");
    expect(session.state.activityHistory.filter((record) => record.activity === 0x4)).toHaveLength(2);
  });

  it("lets Lua custom activity counters inspect Monster Set cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Allowed Set", kind: "monster" },
      { code: "200", name: "Blocked Set", kind: "monster" },
    ];
    const allowedSession = createDuel({ seed: 98, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(allowedSession, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(allowedSession);

    const allowedHost = createLuaScriptHost(allowedSession);
    const allowedResult = allowedHost.loadScript(
      `
      Duel.AddCustomActivityCounter(9800, ACTIVITY_NORMALSUMMON, aux.FilterBoolFunction(Card.IsCode, 100))
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("custom allowed mset result " .. Duel.MSet(target, true, nil))
      Debug.Message("custom allowed mset count " .. Duel.GetCustomActivityCount(9800, 0, ACTIVITY_NORMALSUMMON))
      `,
      "custom-allowed-mset-activity.lua",
    );

    expect(allowedResult.ok, allowedResult.error).toBe(true);
    expect(allowedHost.messages).toContain("custom allowed mset result 1");
    expect(allowedHost.messages).toContain("custom allowed mset count 0");

    const blockedSession = createDuel({ seed: 99, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(blockedSession, {
      0: { main: ["200"] },
      1: { main: [] },
    });
    startDuel(blockedSession);

    const blockedHost = createLuaScriptHost(blockedSession);
    const blockedResult = blockedHost.loadScript(
      `
      Duel.AddCustomActivityCounter(9800, ACTIVITY_NORMALSUMMON, aux.FilterBoolFunction(Card.IsCode, 100))
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("custom blocked mset result " .. Duel.MSet(target, true, nil))
      Debug.Message("custom blocked mset count " .. Duel.GetCustomActivityCount(9800, 0, ACTIVITY_NORMALSUMMON))
      `,
      "custom-blocked-mset-activity.lua",
    );

    expect(blockedResult.ok, blockedResult.error).toBe(true);
    expect(blockedHost.messages).toContain("custom blocked mset result 1");
    expect(blockedHost.messages).toContain("custom blocked mset count 1");
  });

  it("exposes card owner, controller, location, sequence, and position metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "State Probe", kind: "monster", typeFlags: 0x21, attack: 1700, defense: 1300, level: 4, race: 0x2, attribute: 0x20, setcodes: [0x123] },
      { code: "200", name: "Column Spell", kind: "spell", typeFlags: 0x2 },
      { code: "201", name: "Adjacent Spell", kind: "spell", typeFlags: 0x2 },
      { code: "900", name: "Hidden Extra", kind: "extra" },
      { code: "901", name: "Previous Link", kind: "extra", typeFlags: 0x4000001, attack: 1500, level: 2 },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201"], extra: ["900", "901"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    applyAndAssert(session, normal!);
    const columnSpell = session.state.cards.find((card) => card.code === "200" && card.controller === 0);
    expect(columnSpell).toBeDefined();
    const movedColumnSpell = moveDuelCard(session.state, columnSpell!.uid, "spellTrapZone", 0);
    movedColumnSpell.sequence = 0;
    const adjacentSpell = session.state.cards.find((card) => card.code === "201" && card.controller === 0);
    expect(adjacentSpell).toBeDefined();
    const movedAdjacentSpell = moveDuelCard(session.state, adjacentSpell!.uid, "spellTrapZone", 0);
    movedAdjacentSpell.sequence = 1;
    const link = session.state.cards.find((card) => card.code === "901" && card.controller === 0);
    expect(link).toBeDefined();
    const movedLink = moveDuelCard(session.state, link!.uid, "monsterZone", 0);
    movedLink.sequence = 1;
    movedLink.position = "faceUpDefense";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local column_spell = Duel.GetFieldCard(0, LOCATION_SZONE, 0)
      Debug.Message("card state " .. c:GetOwner() .. "/" .. tostring(c:IsOwner(0)) .. "/" .. tostring(c:IsOwner(1,0)) .. "/" .. tostring(c:IsOwner({1,0})) .. "/" .. tostring(c:IsOwner(1)) .. "/" .. c:GetControler() .. "/" .. c:GetLocation() .. "/" .. c:GetSequence() .. "/" .. c:GetPosition())
      Debug.Message("sequence checks " .. tostring(c:IsSequence(0)) .. "/" .. tostring(c:IsSequence(1,0)) .. "/" .. tostring(c:IsSequence({1,0})) .. "/" .. tostring(c:IsSequence({1,2})))
      Debug.Message("original meta " .. c:GetOriginalCode() .. "/" .. c:GetOriginalType() .. "/" .. c:GetOriginalLevel() .. "/" .. c:GetOriginalRace() .. "/" .. c:GetOriginalAttribute())
      Debug.Message("base stats " .. c:GetBaseAttack() .. "/" .. c:GetBaseDefense())
      local defensive_link = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("position checks " .. tostring(c:IsPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(c:IsPosition(POS_FACEUP)) .. "/" .. tostring(defensive_link:IsPosition(POS_FACEUP)) .. "/" .. tostring(defensive_link:IsPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(c:IsControler(0)) .. "/" .. tostring(c:IsControler(1,0)) .. "/" .. tostring(c:IsControler({1,0})) .. "/" .. tostring(c:IsControler(1)))
      local hidden = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("public checks " .. tostring(c:IsPublic()) .. "/" .. tostring(hidden:IsPublic()))
      Debug.Message("relation checks " .. tostring(c:IsOnField()) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsSpell()) .. "/" .. tostring(c:IsTrap()) .. "/" .. tostring(c:IsCanBeEffectTarget(nil)))
      Debug.Message("material checks " .. tostring(c:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(c:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(c:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(c:IsCanBeLinkMaterial(nil)) .. "/" .. tostring(c:IsCanBeRitualMaterial(nil)))
      Debug.Message("activity counts " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_FLIPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_ATTACK) .. "/" .. Duel.GetBattledCount(0))
      Debug.Message("maximum previous checks " .. tostring(c:WasMaximumMode()) .. "/" .. tostring(c:WasMaximumModeCenter()) .. "/" .. tostring(c:WasMaximumModeSide()))
      Debug.Message("column checks " .. tostring(c:IsColumn(column_spell)) .. "/" .. tostring(c:IsColumn(hidden)))
      local column_group = c:GetColumnGroup()
      local adjacent_column_group = c:GetColumnGroup(0,1)
      Debug.Message("column group " .. column_group:GetCount() .. "/" .. tostring(column_group:IsContains(column_spell)) .. "/" .. tostring(column_group:IsContains(c)) .. "/" .. adjacent_column_group:GetCount() .. "/" .. tostring(adjacent_column_group:IsContains(column_spell)) .. "/" .. tostring(adjacent_column_group:IsContains(Duel.GetFieldCard(0, LOCATION_SZONE, 1))))
      Debug.Message("column group count " .. c:GetColumnGroupCount() .. "/" .. c:GetColumnGroupCount(0,1))
      Debug.Message("column zones " .. c:GetColumnZone(LOCATION_MZONE) .. "/" .. c:GetColumnZone(LOCATION_SZONE) .. "/" .. c:GetColumnZone(LOCATION_MZONE,0,1,0) .. "/" .. c:GetColumnZone(LOCATION_MZONE,0,0,1))
      Debug.Message("used summon legality " .. tostring(Duel.IsPlayerCanSummon(0, c)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, c)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, c)))
      Duel.SendtoGrave(c, REASON_EFFECT)
      local g = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("previous state " .. g:GetPreviousLocation() .. "/" .. g:GetPreviousControler() .. "/" .. g:GetPreviousSequence() .. "/" .. g:GetPreviousPosition())
      Debug.Message("previous checks " .. tostring(g:IsPreviousLocation(LOCATION_MZONE)) .. "/" .. tostring(g:IsPreviousLocation(LOCATION_GRAVE,LOCATION_MZONE)) .. "/" .. tostring(g:IsPreviousLocation({LOCATION_GRAVE,LOCATION_MZONE})) .. "/" .. tostring(g:IsPreviousLocation(LOCATION_GRAVE)) .. "/" .. tostring(g:IsPreviousControler(0)) .. "/" .. tostring(g:IsPreviousControler(1,0)) .. "/" .. tostring(g:IsPreviousControler({1,0})) .. "/" .. tostring(g:IsPreviousControler(1)) .. "/" .. tostring(g:IsPreviousSequence(0)) .. "/" .. tostring(g:IsPreviousSequence(1)) .. "/" .. tostring(g:IsPreviousSequence(1,0)) .. "/" .. tostring(g:IsPreviousSequence({1,0})) .. "/" .. tostring(g:IsPreviousSequence({1,2})) .. "/" .. tostring(g:IsPreviousPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(g:IsPreviousPosition(POS_FACEUP_DEFENSE,POS_FACEUP_ATTACK)) .. "/" .. tostring(g:IsPreviousPosition({POS_FACEUP_DEFENSE,POS_FACEUP_ATTACK})) .. "/" .. tostring(g:IsPreviousPosition(POS_FACEUP)) .. "/" .. tostring(g:IsPreviousPosition(POS_FACEUP_DEFENSE)) .. "/" .. tostring(g:IsPreviousSetCard(0x123)) .. "/" .. tostring(g:IsPreviousSetCard({0x456,0x123})) .. "/" .. tostring(g:IsPreviousSetCard({0x456,0x789})))
      Debug.Message("previous identity " .. g:GetPreviousCode() .. "/" .. tostring(g:IsPreviousCode(100)) .. "/" .. tostring(g:IsPreviousCode(900)) .. "/" .. tostring(g:IsPreviousCode(900,100)) .. "/" .. tostring(g:IsPreviousCode({900,100})) .. "/" .. tostring(g:IsPreviousCodeOnField(100)) .. "/" .. tostring(g:IsPreviousCodeOnField(900,100)) .. "/" .. tostring(g:IsPreviousCodeOnField({900,100})))
      Debug.Message("previous type " .. g:GetPreviousTypeOnField() .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_EFFECT)) .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_SPELL,TYPE_EFFECT)) .. "/" .. tostring(g:IsPreviousTypeOnField({TYPE_SPELL,TYPE_EFFECT})) .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_SPELL)))
      Debug.Message("previous stats " .. g:GetPreviousAttackOnField() .. "/" .. tostring(g:IsPreviousAttackOnField(1700)) .. "/" .. g:GetPreviousDefenseOnField() .. "/" .. tostring(g:IsPreviousDefenseOnField(1300)))
      local link = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Duel.SendtoGrave(link, REASON_EFFECT)
      local grave_link = Duel.GetFieldCard(0, LOCATION_GRAVE, 1)
      Debug.Message("previous link defense " .. grave_link:GetPreviousDefenseOnField() .. "/" .. tostring(grave_link:IsPreviousDefenseOnField(0)) .. "/" .. tostring(grave_link:IsPreviousLevelOnField(2)) .. "/" .. tostring(grave_link:IsPreviousPosition(POS_FACEUP)) .. "/" .. tostring(grave_link:IsPreviousPosition(POS_FACEUP_ATTACK)))
      Debug.Message("previous level " .. g:GetPreviousLevelOnField() .. "/" .. tostring(g:IsPreviousLevelOnField(4)) .. "/" .. tostring(g:IsPreviousLevelOnField(7)))
      Debug.Message("previous extra stats " .. g:GetPreviousRankOnField() .. "/" .. tostring(g:IsPreviousRankOnField(4)) .. "/" .. tostring(g:IsPreviousRankOnField(0)) .. "/" .. g:GetPreviousLinkOnField() .. "/" .. tostring(g:IsPreviousLinkOnField(2)))
      Debug.Message("previous traits " .. g:GetPreviousRaceOnField() .. "/" .. tostring(g:IsPreviousRaceOnField(RACE_SPELLCASTER)) .. "/" .. tostring(g:IsPreviousRaceOnField(RACE_DRAGON,RACE_SPELLCASTER)) .. "/" .. tostring(g:IsPreviousRaceOnField({RACE_DRAGON,RACE_SPELLCASTER})) .. "/" .. tostring(g:IsPreviousRaceOnField(RACE_DRAGON)) .. "/" .. g:GetPreviousAttributeOnField() .. "/" .. tostring(g:IsPreviousAttributeOnField(ATTRIBUTE_DARK)) .. "/" .. tostring(g:IsPreviousAttributeOnField(ATTRIBUTE_LIGHT,ATTRIBUTE_DARK)) .. "/" .. tostring(g:IsPreviousAttributeOnField({ATTRIBUTE_LIGHT,ATTRIBUTE_DARK})) .. "/" .. tostring(g:IsPreviousAttributeOnField(ATTRIBUTE_LIGHT)))
      Debug.Message("previous visibility " .. tostring(g:WasFaceup()) .. "/" .. tostring(g:WasFacedown()))
      Debug.Message("reason checks " .. tostring(g:IsReason(REASON_EFFECT)) .. "/" .. tostring(g:IsReason(REASON_BATTLE,REASON_EFFECT)) .. "/" .. tostring(g:IsReason({REASON_BATTLE,REASON_EFFECT})) .. "/" .. tostring(g:IsReason(REASON_BATTLE)))
      Debug.Message("reason player " .. g:GetReasonPlayer() .. "/" .. tostring(g:IsReasonPlayer(0)) .. "/" .. tostring(g:IsReasonPlayer(1,0)) .. "/" .. tostring(g:IsReasonPlayer({1,0})) .. "/" .. tostring(g:IsReasonPlayer(1)))
      Debug.Message("grave relation " .. tostring(g:IsOnField()) .. "/" .. tostring(g:IsMonster()))
      `,
      "card-state.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card state 0/true/true/true/false/0/4/0/1");
    expect(host.messages).toContain("sequence checks true/true/true/false");
    expect(host.messages).toContain("original meta 100/33/4/2/32");
    expect(host.messages).toContain("base stats 1700/1300");
    expect(host.messages).toContain("position checks true/true/true/false/true/true/true/false");
    expect(host.messages).toContain("public checks true/false");
    expect(host.messages).toContain("relation checks true/true/false/false/true");
    expect(host.messages).toContain("material checks true/true/true/true/true");
    expect(host.messages).toContain("activity counts 1/1/0/0/0/0");
    expect(host.messages).toContain("maximum previous checks false/false/false");
    expect(host.messages).toContain("column checks true/false");
    expect(host.messages).toContain("column group 1/true/false/3/true/true");
    expect(host.messages).toContain("column group count 1/3");
    expect(host.messages).toContain("column zones 65537/16777472/196611/65537");
    expect(host.messages).toContain("used summon legality false/false/false");
    expect(host.messages).toContain("previous state 4/0/0/1");
    expect(host.messages).toContain("previous checks true/true/true/false/true/true/true/false/true/false/true/true/false/true/true/true/true/false/true/true/false");
    expect(host.messages).toContain("previous identity 100/true/false/true/true/true/true/true");
    expect(host.messages).toContain("previous type 33/true/true/true/false");
    expect(host.messages).toContain("previous stats 1700/true/1300/true");
    expect(host.messages).toContain("previous link defense 0/false/false/true/false");
    expect(host.messages).toContain("previous level 4/true/false");
    expect(host.messages).toContain("previous extra stats 0/false/false/0/false");
    expect(host.messages).toContain("previous traits 2/true/true/true/false/32/true/true/true/false");
    expect(host.messages).toContain("previous visibility true/false");
    expect(host.messages).toContain("reason checks true/true/true/false");
    expect(host.messages).toContain("reason player 0/true/true/true/false");
    expect(host.messages).toContain("grave relation false/true");
  });

  it("exposes Lua reason card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Reason Target", kind: "monster", typeFlags: 0x21 },
      { code: "300", name: "Other Card", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 221, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((candidate) => candidate.code === "100");
    const target = session.state.cards.find((candidate) => candidate.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    const movedTarget = moveDuelCard(session.state, target!.uid, "graveyard", 0);
    movedTarget.reasonCardUid = source!.uid;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local other=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("reason card " .. target:GetReasonCard():GetCode() .. "/" .. tostring(source:IsReasonCard(target)) .. "/" .. tostring(other:IsReasonCard(target)) .. "/" .. tostring(source:GetReasonCard()==nil))
      `,
      "reason-card.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("reason card 100/true/false/true");
  });

  it("checks Lua card-to-card field relation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Related Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Related Target", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 222, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((candidate) => candidate.code === "100");
    const target = session.state.cards.find((candidate) => candidate.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const related = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("card relation field " .. tostring(source:IsRelateToCard(target)) .. "/" .. tostring(target:IsRelateToCard(source)))
      `,
      "card-relation-field.lua",
    );
    expect(related.ok, related.error).toBe(true);
    expect(host.messages).toContain("card relation field true/true");

    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    const moved = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("card relation moved " .. tostring(source:IsRelateToCard(target)))
      `,
      "card-relation-moved.lua",
    );
    expect(moved.ok, moved.error).toBe(true);
    expect(host.messages).toContain("card relation moved false");
  });

  it("lets Lua scripts check destroyed-by-opponent-from-field conditions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Destroyed Probe", kind: "monster" }];
    const session = createDuel({ seed: 207, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    moveDuelCard(session.state, card!.uid, "graveyard", 0, duelReason.destroy | duelReason.effect, 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      local e = Effect.CreateEffect(c)
      Debug.Message("dogcon values " .. tostring(aux.dogcon(e,0,nil,0,0,nil,0,1)) .. "/" .. tostring(aux.dogcon(e,0,nil,0,0,nil,0,0)) .. "/" .. tostring(aux.dogcon(e,1,nil,0,0,nil,0,0)))
      `,
      "aux-dogcon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dogcon values true/false/false");
  });

  it("lets Lua scripts check whether cards have non-zero attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Nonzero Attack", kind: "monster", attack: 1500, defense: 1200 },
      { code: "200", name: "Zero Attack", kind: "monster", attack: 0, defense: 0 },
      { code: "300", name: "Missing Attack", kind: "monster" },
    ];
    const session = createDuel({ seed: 70, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local positive = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local zero = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local missing = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("nonzero attack " .. tostring(positive:HasNonZeroAttack()))
      Debug.Message("zero attack " .. tostring(zero:HasNonZeroAttack()))
      Debug.Message("missing attack " .. tostring(missing:HasNonZeroAttack()))
      Debug.Message("nonzero defense " .. tostring(positive:HasNonZeroDefense()))
      Debug.Message("zero defense " .. tostring(zero:HasNonZeroDefense()))
      Debug.Message("missing defense " .. tostring(missing:HasNonZeroDefense()))
      `,
      "has-nonzero-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("nonzero attack true");
    expect(host.messages).toContain("zero attack false");
    expect(host.messages).toContain("missing attack false");
    expect(host.messages).toContain("nonzero defense true");
    expect(host.messages).toContain("zero defense false");
    expect(host.messages).toContain("missing defense false");
  });

  it("lets Lua scripts add and remove card counters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Counter", kind: "monster" },
      { code: "200", name: "Opponent Counter", kind: "monster" },
      { code: "300", name: "Deck Counter", kind: "monster" },
    ];
    const session = createDuel({ seed: 77, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const self = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const deck = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    expect(self).toBeDefined();
    expect(opponent).toBeDefined();
    expect(deck).toBeDefined();
    moveDuelCard(session.state, self!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    moveDuelCard(session.state, deck!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local self = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local deck = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      self:EnableCounterPermit(99)
      opp:EnableCounterPermit(99)
      Debug.Message("add self " .. tostring(self:AddCounter(99, 2)) .. "/" .. self:GetCounter(99) .. "/" .. tostring(self:HasCounter()) .. "/" .. tostring(self:HasCounter(99)) .. "/" .. tostring(self:HasCounter(77)) .. "/" .. tostring(self:HasCounters()))
      Debug.Message("add opp " .. tostring(opp:AddCounter(99, 1)) .. "/" .. opp:GetCounter(99))
      Debug.Message("can add deck " .. tostring(deck:IsCanAddCounter(99, 1)) .. "/" .. tostring(deck:AddCounter(99, 1)))
      Debug.Message("duel can add " .. tostring(Duel.IsCanAddCounter(0, 99, 1, self)) .. "/" .. tostring(Duel.IsCanAddCounter(0, 99, 1, deck)) .. "/" .. tostring(Duel.IsCanAddCounter(0, 99, 1)))
      Debug.Message("can remove self " .. tostring(Duel.IsCanRemoveCounter(0, 1, 0, 99, 2, REASON_COST)))
      Debug.Message("can remove both " .. tostring(Duel.IsCanRemoveCounter(0, 1, 1, 99, 3, REASON_COST)))
      Debug.Message("duel counter totals " .. Duel.GetCounter(0, 1, 0, 99) .. "/" .. Duel.GetCounter(0, 1, 1, 99))
      Debug.Message("remove one " .. tostring(self:RemoveCounter(0, 99, 1, REASON_COST)) .. "/" .. self:GetCounter(99))
      Debug.Message("duel remove " .. Duel.RemoveCounter(0, 1, 1, 99, 2, REASON_COST))
      Debug.Message("duel operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("after counters " .. self:GetCounter(99) .. "/" .. opp:GetCounter(99))
      `,
      "card-counters.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("add self true/2/true/true/false/true");
    expect(host.messages).toContain("add opp true/1");
    expect(host.messages).toContain("can add deck false/false");
    expect(host.messages).toContain("duel can add true/false/true");
    expect(host.messages).toContain("can remove self true");
    expect(host.messages).toContain("can remove both true");
    expect(host.messages).toContain("duel counter totals 2/3");
    expect(host.messages).toContain("remove one true/1");
    expect(host.messages).toContain("duel remove 2");
    expect(host.messages).toContain("duel operated 2");
    expect(host.messages).toContain("after counters 0/0");
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.cards.find((card) => card.uid === self!.uid)?.counters).toBeUndefined();
  });

  it("lets Lua scripts inspect and remove all card counters", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "All Counter", kind: "monster" }];
    const session = createDuel({ seed: 228, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      target:EnableCounterPermit(99)
      target:EnableCounterPermit(77)
      target:AddCounter(99, 2)
      target:AddCounter(77, 3)
      local all = target:GetAllCounters()
      local all_count = 0
      for _ in pairs(all) do all_count = all_count + 1 end
      Debug.Message("all counters " .. all[99] .. "/" .. all[77] .. "/" .. tostring(all[66] == nil) .. "/" .. all_count)
      Debug.Message("remove all " .. target:RemoveAllCounters() .. "/" .. target:GetCounter(99) .. "/" .. target:GetCounter(77) .. "/" .. tostring(target:HasCounters()))
      local empty = target:GetAllCounters()
      local empty_count = 0
      for _ in pairs(empty) do empty_count = empty_count + 1 end
      Debug.Message("empty counters " .. tostring(empty[99] == nil) .. "/" .. empty_count)
      `,
      "card-all-counters.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["all counters 2/3/true/2", "remove all 5/0/0/false", "empty counters true/0"]);
    expect(target!.counters).toBeUndefined();
  });

  it("keeps all-counter removal from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Ended All Counter", kind: "monster" }];
    const session = createDuel({ seed: 229, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      target:EnableCounterPermit(99)
      Debug.Message("setup counter " .. tostring(target:AddCounter(99, 1)) .. "/" .. target:GetCounter(99))
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("remove all ended " .. target:RemoveAllCounters() .. "/" .. target:GetCounter(99))
      `,
      "ended-card-all-counters.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["setup counter true/1", "remove all ended 0/1"]);
    expect(session.state.status).toBe("ended");
    expect(target!.counters).toEqual({ 99: 1 });
  });

  it("honors Lua counter permits, target filters, and limits", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Limited Counter", kind: "monster" },
      { code: "200", name: "Filtered Counter", kind: "monster" },
    ];
    const session = createDuel({ seed: 230, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0)) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local limited = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local filtered = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("without permit " .. tostring(limited:IsCanAddCounter(99,1)) .. "/" .. tostring(limited:AddCounter(99,1)))
      Debug.Message("permit return count " .. select("#", limited:EnableCounterPermit(99)) .. "/" .. select("#", limited:SetCounterLimit(99,3)))
      Debug.Message("with permit " .. tostring(limited:IsCanAddCounter(99,2)) .. "/" .. tostring(limited:AddCounter(99,2)) .. "/" .. limited:GetCounter(99))
      Debug.Message("over limit " .. tostring(limited:IsCanAddCounter(99,2)) .. "/" .. tostring(limited:AddCounter(99,2)) .. "/" .. limited:GetCounter(99))
      Debug.Message("singly limit " .. tostring(limited:IsCanAddCounter(99,2,true)) .. "/" .. tostring(limited:AddCounter(99,2,true)) .. "/" .. limited:GetCounter(99))
      filtered:EnableCounterPermit(77,LOCATION_MZONE,function(e,c) return c:IsCode(100) end)
      limited:EnableCounterPermit(77,LOCATION_MZONE,function(e,c) return c:IsCode(100) end)
      Debug.Message("target permit " .. tostring(limited:AddCounter(77,1)) .. "/" .. tostring(filtered:AddCounter(77,1)))
      Debug.Message("loc permit " .. tostring(limited:IsCanAddCounter(77,1,false,LOCATION_MZONE)) .. "/" .. tostring(limited:IsCanAddCounter(77,1,false,LOCATION_SZONE)))
      Debug.Message("without permit flag " .. tostring(filtered:AddCounter(COUNTER_WITHOUT_PERMIT+88,1)) .. "/" .. filtered:GetCounter(COUNTER_WITHOUT_PERMIT+88))
      Debug.Message("need enable storage " .. tostring(filtered:AddCounter(COUNTER_NEED_ENABLE+COUNTER_WITHOUT_PERMIT+89,1)) .. "/" .. filtered:GetCounter(COUNTER_WITHOUT_PERMIT+89))
      `,
      "card-counter-permits.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "without permit false/false",
      "permit return count 0/0",
      "with permit true/true/2",
      "over limit false/false/2",
      "singly limit true/true/3",
      "target permit true/false",
      "loc permit true/false",
      "without permit flag true/1",
      "need enable storage true/1",
    ]);
  });

  it("clears reset-while-negated counters when cards become disabled", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Counter Negation Target", kind: "monster" },
      { code: "200", name: "Counter Negation Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 232, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    const source = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    expect(source).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      target:EnableCounterPermit(99)
      target:AddCounter(99,2)
      target:AddCounter(COUNTER_WITHOUT_PERMIT+88,3)
      target:AddCounter(COUNTER_NEED_ENABLE+COUNTER_WITHOUT_PERMIT+89,4)
      Debug.Message("before disable " .. target:GetCounter(99) .. "/" .. target:GetCounter(COUNTER_WITHOUT_PERMIT+88) .. "/" .. target:GetCounter(COUNTER_WITHOUT_PERMIT+89))
      target:NegateEffects(source, RESET_PHASE|PHASE_END, true, 1)
      Debug.Message("after disable " .. tostring(target:IsDisabled()) .. "/" .. target:GetCounter(99) .. "/" .. target:GetCounter(COUNTER_WITHOUT_PERMIT+88) .. "/" .. target:GetCounter(COUNTER_WITHOUT_PERMIT+89))
      `,
      "counter-disable-buckets.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["before disable 2/3/4", "after disable true/0/3/0"]);
    expect(target!.counters).toEqual({ [0x1000 + 88]: 3 });
    expect(target!.counterBuckets).toEqual({ [0x1000 + 88]: { permanent: 3 } });
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.cards.find((card) => card.uid === target!.uid)?.counterBuckets).toEqual({ [0x1000 + 88]: { permanent: 3 } });
  });

  it("removes counters when Lua counter permit effects are removed", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Permit Reset Counter", kind: "monster" }];
    const session = createDuel({ seed: 231, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local delete_permit = Effect.CreateEffect(target)
      delete_permit:SetType(EFFECT_TYPE_SINGLE)
      delete_permit:SetCode(EFFECT_COUNTER_PERMIT+99)
      delete_permit:SetValue(LOCATION_MZONE)
      target:RegisterEffect(delete_permit)
      target:AddCounter(99, 2)
      Debug.Message("before delete " .. target:GetCounter(99) .. "/" .. tostring(target:IsHasEffect(EFFECT_COUNTER_PERMIT+99)~=nil))
      delete_permit:Delete()
      Debug.Message("after delete " .. target:GetCounter(99) .. "/" .. tostring(target:IsHasEffect(EFFECT_COUNTER_PERMIT+99)~=nil))

      local reset_permit = Effect.CreateEffect(target)
      reset_permit:SetType(EFFECT_TYPE_SINGLE)
      reset_permit:SetCode(EFFECT_COUNTER_PERMIT+99)
      reset_permit:SetValue(LOCATION_MZONE)
      target:RegisterEffect(reset_permit)
      target:AddCounter(99, 3)
      target:ResetEffect(EFFECT_COUNTER_PERMIT+99, RESET_CODE)
      Debug.Message("after reset " .. target:GetCounter(99) .. "/" .. tostring(target:IsHasEffect(EFFECT_COUNTER_PERMIT+99)~=nil))
      `,
      "counter-permit-removal.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["before delete 2/true", "after delete 0/false", "after reset 0/false"]);
    expect(target!.counters).toBeUndefined();
  });

  it("lets Lua scripts use counter removal cost aliases", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Counter Cost", kind: "monster" },
      { code: "200", name: "Field Counter Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 78, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const self = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(self).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, self!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local self=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      self:EnableCounterPermit(77)
      opp:EnableCounterPermit(77)
      self:AddCounter(77,3)
      opp:AddCounter(77,1)
      local e=Effect.CreateEffect(self)
      local self_cost=Cost.RemoveCounterFromSelf(77,1)
      local field_cost=Cost.RemoveCounterFromField(77,2)
      Debug.Message("self counter check " .. tostring(self_cost(e,0,Group.CreateGroup(),0,0,nil,0,0,0)) .. "/" .. tostring(self:IsCanRemoveCounter(0,77,2,REASON_COST)))
      self_cost(e,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self counter after " .. self:GetCounter(77) .. "/" .. opp:GetCounter(77))
      Debug.Message("field counter check " .. tostring(field_cost(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      field_cost(e,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("field counter after " .. self:GetCounter(77) .. "/" .. opp:GetCounter(77) .. "/" .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("field counter blocked " .. tostring(field_cost(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      `,
      "counter-cost-aliases.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("self counter check true/true");
    expect(host.messages).toContain("self counter after 2/1");
    expect(host.messages).toContain("field counter check true");
    expect(host.messages).toContain("field counter after 0/1/1");
    expect(host.messages).toContain("field counter blocked false");
  });

  it("lets Lua scripts use selected effect and replaceable cost helpers", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Replace Cost Source", kind: "monster" }];
    const session = createDuel({ seed: 79, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetDescription(701)
      Debug.Message("hint selected check " .. tostring(Cost.HintSelectedEffect(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      Cost.HintSelectedEffect(e,0,Group.CreateGroup(),0,0,nil,0,0,1)

      local replacement=Effect.CreateEffect(c)
      replacement:SetType(EFFECT_TYPE_FIELD)
      replacement:SetCode(EFFECT_COST_REPLACE)
      replacement:SetRange(LOCATION_MZONE)
      replacement:SetTargetRange(1,0)
      replacement:SetDescription(702)
      replacement:SetValue(1)
      replacement:SetCountLimit(1)
      replacement:SetOperation(function(repl,extracon,source_effect,tp)
        Debug.Message("replace operation " .. repl:GetDescription() .. "/" .. source_effect:GetDescription() .. "/" .. tostring(extracon(source_effect,tp)))
        return "replaced"
      end)
      c:RegisterEffect(replacement)

      local base_count=0
      local base=function(effect,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return false end
        base_count=base_count+1
        Debug.Message("base paid " .. base_count)
        return "base"
      end
      local replaced=Cost.Replaceable(base,function(effect,tp) return effect:GetDescription()==701 end)
      Debug.Message("replace check " .. tostring(replaced(e,0,Group.CreateGroup(),0,0,nil,0,0,0)) .. "/" .. tostring(replacement:CheckCountLimit(0)))
      Debug.Message("replace result " .. replaced(e,0,Group.CreateGroup(),0,0,nil,0,0,1) .. "/" .. tostring(replacement:CheckCountLimit(0)))
      Debug.Message("replace blocked " .. tostring(replaced(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))

      local fallback=Cost.Replaceable(function(effect,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Debug.Message("fallback base paid")
        return "fallback"
      end)
      Debug.Message("fallback result " .. fallback(e,0,Group.CreateGroup(),0,0,nil,0,0,1))
      Debug.Message("alias check " .. tostring(aux.CostWithReplace==Cost.Replaceable))
      `,
      "replaceable-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hint selected check true");
    expect(host.messages).toContain("replace check true/true");
    expect(host.messages).toContain("replace operation 702/701/true");
    expect(host.messages).toContain("replace result replaced/false");
    expect(host.messages).toContain("replace blocked false");
    expect(host.messages).toContain("fallback base paid");
    expect(host.messages).toContain("fallback result fallback");
    expect(host.messages).toContain("alias check true");
  });

  it("lets Lua scripts check whether cards can change battle position", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Face-up Monster", kind: "monster" },
      { code: "200", name: "Face-down Monster", kind: "monster" },
      { code: "300", name: "Link Monster", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "400", name: "Hand Monster", kind: "monster" },
      { code: "500", name: "Already Attacked", kind: "monster" },
      { code: "600", name: "Already Changed", kind: "monster" },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "400", "500", "600"], extra: ["300"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const faceUp = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const faceDown = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const attacked = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const changed = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const link = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "300");
    expect(faceUp).toBeDefined();
    expect(faceDown).toBeDefined();
    expect(attacked).toBeDefined();
    expect(changed).toBeDefined();
    expect(link).toBeDefined();
    moveDuelCard(session.state, faceUp!.uid, "monsterZone", 0).position = "faceUpAttack";
    const setMonster = moveDuelCard(session.state, faceDown!.uid, "monsterZone", 0);
    setMonster.position = "faceDownDefense";
    setMonster.faceUp = false;
    moveDuelCard(session.state, link!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacked!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.attacksDeclared.push(attacked!.uid);
    moveDuelCard(session.state, changed!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.positionsChanged.push(changed!.uid);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local faceup = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local facedown = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local link = Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      local attacked = Duel.GetFieldCard(0, LOCATION_MZONE, 3)
      local changed = Duel.GetFieldCard(0, LOCATION_MZONE, 4)
      local hand = Duel.GetFieldCard(0, LOCATION_HAND, 0)
      Debug.Message("turn set faceup " .. tostring(faceup:IsCanTurnSet()))
      Debug.Message("turn set facedown " .. tostring(facedown:IsCanTurnSet()))
      Debug.Message("turn set link " .. tostring(link:IsCanTurnSet()))
      Debug.Message("turn set hand " .. tostring(hand:IsCanTurnSet()))
      Debug.Message("turn set attacked " .. tostring(attacked:IsCanTurnSet()))
      Debug.Message("turn set changed " .. tostring(changed:IsCanTurnSet()))
      Debug.Message("change faceup any " .. tostring(faceup:IsCanChangePosition()))
      Debug.Message("change rush faceup any " .. tostring(faceup:IsCanChangePositionRush()))
      Debug.Message("change faceup defense " .. tostring(faceup:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("change rush faceup defense " .. tostring(faceup:IsCanChangePositionRush(POS_FACEUP_DEFENSE)))
      Debug.Message("change faceup attack " .. tostring(faceup:IsCanChangePosition(POS_FACEUP_ATTACK)))
      Debug.Message("change facedown any " .. tostring(facedown:IsCanChangePosition()))
      Debug.Message("change link any " .. tostring(link:IsCanChangePosition()))
      Debug.Message("change hand any " .. tostring(hand:IsCanChangePosition()))
      Debug.Message("change attacked any " .. tostring(attacked:IsCanChangePosition()))
      Debug.Message("change changed any " .. tostring(changed:IsCanChangePosition()))
      `,
      "card-position-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "turn set faceup true",
      "turn set facedown false",
      "turn set link false",
      "turn set hand false",
      "turn set attacked true",
      "turn set changed true",
      "change faceup any true",
      "change rush faceup any true",
      "change faceup defense true",
      "change rush faceup defense true",
      "change faceup attack false",
      "change facedown any true",
      "change link any false",
      "change hand any false",
      "change attacked any true",
      "change changed any true",
    ]);
  });

  it("treats Lua position predicates as effect-change checks for same-turn cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summoned Lockout", kind: "monster" },
      { code: "200", name: "Set Lockout", kind: "monster" },
    ];
    const session = createDuel({ seed: 22, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(summoned).toBeDefined();
    expect(set).toBeDefined();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === set!.uid);
    expect(setAction).toBeDefined();
    applyAndAssert(session, setAction!);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("change summoned same turn " .. tostring(summoned:IsCanChangePosition()))
      Debug.Message("change set same turn " .. tostring(set:IsCanChangePosition()))
      Debug.Message("turn set summoned same turn " .. tostring(summoned:IsCanTurnSet()))
      Debug.Message("turn set set same turn " .. tostring(set:IsCanTurnSet()))
      `,
      "card-position-same-turn-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["change summoned same turn true", "change set same turn true", "turn set summoned same turn true", "turn set set same turn false"]);
  });

  it("restores same-turn Lua effect-change position predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Summoned Lockout", kind: "monster" },
      { code: "200", name: "Restored Set Lockout", kind: "monster" },
    ];
    const session = createDuel({ seed: 24, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(summoned).toBeDefined();
    expect(set).toBeDefined();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === set!.uid);
    expect(setAction).toBeDefined();
    applyAndAssert(session, setAction!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("restored change summoned " .. tostring(summoned:IsCanChangePosition()))
      Debug.Message("restored turn set summoned " .. tostring(summoned:IsCanTurnSet()))
      Debug.Message("restored change set " .. tostring(set:IsCanChangePosition()))
      `,
      "card-position-restored-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored change summoned true", "restored turn set summoned true", "restored change set true"]);
  });

  it("clears Lua position lockouts after the turn cycles", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Next Turn Summoned", kind: "monster" },
      { code: "200", name: "Next Turn Set", kind: "monster" },
    ];
    const session = createDuel({ seed: 23, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(summoned).toBeDefined();
    expect(set).toBeDefined();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === set!.uid);
    expect(setAction).toBeDefined();
    applyAndAssert(session, setAction!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn")!);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("change summoned next turn " .. tostring(summoned:IsCanChangePosition()))
      Debug.Message("turn set summoned next turn " .. tostring(summoned:IsCanTurnSet()))
      Debug.Message("change set next turn " .. tostring(set:IsCanChangePosition()))
      `,
      "card-position-next-turn-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["change summoned next turn true", "turn set summoned next turn true", "change set next turn true"]);
  });

  it("lets Lua scripts build summon-code filters", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Aliased Summon Material", kind: "monster" },
      { code: "300", name: "Other Summon Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 164, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local aliased = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local other = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local filter = aux.FilterSummonCode(101, 500)
      Debug.Message("summon code direct " .. tostring(aliased:IsSummonCode(nil, 0, 0, 101)))
      Debug.Message("summon code filter alias " .. tostring(filter(aliased, nil, 0, 0)))
      Debug.Message("summon code filter miss " .. tostring(filter(other, nil, 0, 0)))
      `,
      "summon-code-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon code direct true");
    expect(host.messages).toContain("summon code filter alias true");
    expect(host.messages).toContain("summon code filter miss false");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
