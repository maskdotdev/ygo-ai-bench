import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua card relation state helpers", () => {
  it("runs delayed Lua operations on matching phase transitions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Delay Source", kind: "monster" },
      { code: "200", name: "Delay Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local effect=Effect.CreateEffect(source)
      local delayed=aux.DelayedOperation(target,PHASE_BATTLE,777047,effect,0,function(g,e,tp)
        Debug.Message("delayed operation " .. g:GetCount() .. "/" .. tp .. "/" .. g:GetFirst():GetFlagEffectLabel(777047))
      end,function(g,e,tp) return tp==0 and g:GetCount()==1 end,nil,1,701,702)
      Debug.Message("delayed setup " .. delayed:GetCode() .. "/" .. delayed:GetDescription() .. "/" .. target:GetFlagEffect(777047))
      `,
      "delayed-operation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("delayed setup 4224/702/1");
    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    applyResponse(session, battlePhase!);
    expect(host.messages).toContain("delayed operation 1/0/1");
    expect(session.state.effects.some((effect) => effect.code === 0x1000 + 0x80)).toBe(false);
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Prompt Source", kind: "monster", attribute: 0x1, race: 0x1 },
      { code: "200", name: "Prompt Target", kind: "monster", attribute: 0x2, race: 0x2 },
    ];
    const session = createDuel({ seed: 30, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local option=Duel.SelectOption(0, 101, 102, 103)
      local cancel_option=Duel.SelectOption(0, false, 101, 102, 103)
      local empty_cancel_option=Duel.SelectOption(0, false)
      local yes=Duel.SelectYesNo(0, 201)
      local everyone=Duel.AskEveryone(203)
      local any=Duel.AskAny(204)
      local effect_yes=Duel.SelectEffectYesNo(0, nil, 202)
      local effect_choice=Duel.SelectEffect(0, {false, 301}, {true, 302}, {true, 303})
      local effect_none=Duel.SelectEffect(0, {false, 301})
      local number=Duel.AnnounceNumber(0, 4, 7, 9)
      local table_number=Duel.AnnounceNumber(0, {6, 8, 10})
      local card=Duel.AnnounceCard(0, 100, 200)
      local default_card=Duel.AnnounceCard(0)
      local typed_card=Duel.AnnounceCard(0, TYPE_MONSTER)
      local table_card=Duel.AnnounceCard(0, {200, OPCODE_ISCODE})
      local kind=Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local race=Duel.AnnounceRace(0, RACE_WARRIOR, RACE_SPELLCASTER)
      local attribute=Duel.AnnounceAttribute(0, ATTRIBUTE_LIGHT, ATTRIBUTE_DARK)
      local upstream_race=Duel.AnnounceRace(0, 1, RACE_DRAGON|RACE_SPELLCASTER)
      local upstream_attribute=Duel.AnnounceAttribute(0, 1, ATTRIBUTE_FIRE|ATTRIBUTE_DARK)
      local level=Duel.AnnounceLevel(0, 3, 5, 7)
      local default_level=Duel.AnnounceLevel(0)
      local excluded_level=Duel.AnnounceLevel(0, 3, 5, 3, 4)
      local ranged=Duel.AnnounceNumberRange(0, 2, 5, 2, 3)
      local selected_code=Duel.SelectCardsFromCodes(0, 1, 1, false, false, 700, 800)
      local selected_from_table=Duel.SelectCardsFromCodes(0, 1, 1, false, false, {900, 901})
      local selected_index=Duel.SelectCardsFromCodes(0, 1, 1, false, true, 910, 920)
      local selected_multi={Duel.SelectCardsFromCodes(0, 1, 2, false, true, 930, 940, 950)}
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      local selected_zone=Duel.SelectFieldZone(0, 1, 0, LOCATION_MZONE, 0)
      local group=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 2, nil)
      local earth_group=Duel.SelectMatchingCard(0, Card.IsCode, 0, LOCATION_HAND, 0, 1, 1, nil, 100)
      local another_earth=Duel.AnnounceAnotherAttribute(earth_group, 0)
      local another_mixed=Duel.AnnounceAnotherAttribute(group, 0)
      local another_warrior_race=Duel.AnnounceAnotherRace(earth_group, 0)
      local another_mixed_race=Duel.AnnounceAnotherRace(group, 0)
      local single=group:GetFirst()
      local another_card_attribute=earth_group:GetFirst():AnnounceAnotherAttribute(0)
      local another_card_race=single:AnnounceAnotherRace(0)
      local group_hint_result=Duel.HintSelection(group, 501)
      local card_hint_result=Duel.HintSelection(single)
      Debug.Message("prompt option " .. option .. "/" .. cancel_option .. "/" .. empty_cancel_option .. "/" .. tostring(yes) .. "/" .. tostring(everyone) .. "/" .. tostring(any))
      Debug.Message("prompt effect " .. tostring(effect_yes) .. "/" .. tostring(effect_choice) .. "/" .. tostring(effect_none))
      Debug.Message("prompt announce " .. number .. "/" .. table_number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute .. "/" .. upstream_race .. "/" .. upstream_attribute .. "/" .. level .. "/" .. default_level .. "/" .. excluded_level .. "/" .. ranged)
      Debug.Message("prompt announce card " .. default_card .. "/" .. typed_card .. "/" .. table_card)
      Debug.Message("prompt card codes " .. selected_code .. "/" .. selected_from_table .. "/" .. selected_index[1] .. ":" .. selected_index[2] .. "/" .. selected_multi[1][1] .. ":" .. selected_multi[1][2] .. "," .. selected_multi[2][1] .. ":" .. selected_multi[2][2])
      Debug.Message("prompt another attribute " .. another_earth .. "/" .. another_mixed .. "/" .. another_card_attribute)
      Debug.Message("prompt another race " .. another_warrior_race .. "/" .. another_mixed_race .. "/" .. another_card_race)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. selected_zone .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      Debug.Message("hint return " .. tostring(group_hint_result == nil) .. "/" .. tostring(card_hint_result == nil))
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("prompt option 0/1/-1/true/true/true");
    expect(host.messages).toContain("prompt effect true/2/nil");
    expect(host.messages).toContain("prompt announce 4/6/100/1/2/32/2/4/3/1/5/4");
    expect(host.messages).toContain("prompt announce card 100/100/200");
    expect(host.messages).toContain("prompt card codes 700/900/910:1/930:1,940:2");
    expect(host.messages).toContain("prompt another attribute 2/1/2");
    expect(host.messages).toContain("prompt another race 2/1/1");
    expect(host.messages).toContain("prompt zones 1/768/65536/31/96");
    expect(host.messages).toContain("hint return true/true");
    const hintLogs = session.state.log.filter((entry) => entry.action === "hintSelection");
    expect(hintLogs).toHaveLength(2);
    expect(hintLogs[0]).toMatchObject({ player: 0 });
    expect(hintLogs[0]?.detail).toMatch(/^2 selected: (100,200|200,100) \(501\)$/);
    expect(hintLogs[1]?.detail).toMatch(/^1 selected: (100|200)$/);
  });

  it("stores Lua cancel-to-grave state on card instances", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Cancel Grave Source", kind: "spell" }];
    const session = createDuel({ seed: 29, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      c:CancelToGrave()
      Debug.Message("cancel grave set")
      c:CancelToGrave(false)
      Debug.Message("cancel grave cleared")
      `,
      "cancel-to-grave.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["cancel grave set", "cancel grave cleared"]);
    expect(session.state.cards.find((card) => card.code === "100")?.cancelToGrave).toBe(false);
  });

  it("stores Lua effect relation state on card instances", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Effect Relation Source", kind: "monster" }];
    const session = createDuel({ seed: 30, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local e=Effect.CreateEffect(c)
      c:CreateEffectRelation(e)
      Debug.Message("effect relation created " .. tostring(c:IsRelateToEffect(e)))
      c:ReleaseEffectRelation(e)
      Debug.Message("effect relation released " .. tostring(c:IsRelateToEffect(e)))
      local e2=Effect.CreateEffect(c)
      c:CreateEffectRelation(e)
      c:CreateEffectRelation(e2)
      Debug.Message("effect relation before clear " .. tostring(c:IsRelateToEffect(e)) .. "/" .. tostring(c:IsRelateToEffect(e2)))
      c:ClearEffectRelation()
      Debug.Message("effect relation cleared " .. tostring(c:IsRelateToEffect(e)) .. "/" .. tostring(c:IsRelateToEffect(e2)))
      `,
      "effect-relation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "effect relation created true",
      "effect relation released false",
      "effect relation before clear true/true",
      "effect relation cleared false/false",
    ]);
    expect(session.state.cards.find((card) => card.code === "100")?.effectRelationIds).toEqual([]);
  });

  it("stores Lua card target relation state on card instances", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Card Target Source", kind: "monster" },
      { code: "200", name: "Card Target A", kind: "monster" },
      { code: "300", name: "Card Target B", kind: "monster" },
    ];
    const session = createDuel({ seed: 231, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local first=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local second=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local function result_count(...) return select("#", ...) end
      Debug.Message("card target before " .. tostring(source:IsHasCardTarget(first)))
      Debug.Message("card target set " .. result_count(source:SetCardTarget(first)) .. "/" .. tostring(source:IsHasCardTarget(first)) .. "/" .. tostring(source:IsHasCardTarget(second)))
      Debug.Message("card relation create " .. result_count(source:CreateRelation(second,RESET_EVENT+RESETS_STANDARD)) .. "/" .. tostring(source:IsHasCardTarget(second)))
      Debug.Message("card relation related " .. tostring(source:IsRelateToCard(first)) .. "/" .. tostring(source:IsRelateToCard(second)))
      Debug.Message("card target group " .. source:GetCardTargetCount() .. "/" .. source:GetCardTarget():GetCount() .. "/" .. source:GetFirstCardTarget():GetCode())
      Debug.Message("owner target first " .. first:GetOwnerTargetCount() .. "/" .. first:GetOwnerTarget():GetCount() .. "/" .. first:GetFirstOwnerTarget():GetCode())
      source:CancelCardTarget(first)
      Debug.Message("card target cancel " .. tostring(source:IsHasCardTarget(first)) .. "/" .. tostring(source:IsHasCardTarget(second)))
      Debug.Message("card target group after " .. source:GetCardTargetCount() .. "/" .. source:GetCardTarget():GetCount() .. "/" .. source:GetFirstCardTarget():GetCode())
      Debug.Message("owner target after " .. first:GetOwnerTargetCount() .. "/" .. first:GetOwnerTarget():GetCount() .. "/" .. tostring(first:GetFirstOwnerTarget()==nil))
      `,
      "card-target-relation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "card target before false",
      "card target set 0/true/false",
      "card relation create 0/true",
      "card relation related true/true",
      "card target group 2/2/200",
      "owner target first 1/1/100",
      "card target cancel false/true",
      "card target group after 1/1/300",
      "owner target after 0/0/true",
    ]);
    expect(session.state.cards.find((card) => card.code === "100")?.cardTargetUids).toHaveLength(1);
  });

  it("keeps card relation helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Relation Source", kind: "monster" },
      { code: "200", name: "Ended Relation Target A", kind: "monster" },
      { code: "300", name: "Ended Relation Target B", kind: "monster" },
    ];
    const session = createDuel({ seed: 232, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local first=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local second=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local function result_count(...) return select("#", ...) end
      local e=Effect.CreateEffect(source)
      source:CreateEffectRelation(e)
      source:SetCardTarget(first)
      source:CancelToGrave()
      Duel.Win(0,WIN_REASON_EXODIA)
      source:ReleaseEffectRelation(e)
      source:ClearEffectRelation()
      source:CancelCardTarget(first)
      source:CancelToGrave(false)
      Debug.Message("set ended " .. result_count(source:SetCardTarget(second)))
      Debug.Message("relation ended " .. result_count(source:CreateRelation(second,RESET_EVENT+RESETS_STANDARD)))
      Debug.Message("effect kept " .. tostring(source:IsRelateToEffect(e)))
      Debug.Message("targets kept " .. tostring(source:IsHasCardTarget(first)) .. "/" .. tostring(source:IsHasCardTarget(second)) .. "/" .. source:GetCardTargetCount())
      `,
      "ended-card-relation-noop.lua",
    );
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toEqual([
      "set ended 0",
      "relation ended 0",
      "effect kept true",
      "targets kept true/false/1",
    ]);
    expect(session.state.status).toBe("ended");
    expect(source!.effectRelationIds).toHaveLength(1);
    expect(source!.cardTargetUids).toEqual([first!.uid]);
    expect(source!.cancelToGrave).toBe(true);
    expect(source!.cardTargetUids).not.toContain(second!.uid);
  });

  it("checks Rush trait change availability from current and original traits", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Rush Trait Source", kind: "monster", race: 0x2, attribute: 0x10 }];
    const session = createDuel({ seed: 31, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      Debug.Message("rush original traits " .. tostring(c:CanChangeIntoTypeRush(RACE_SPELLCASTER)) .. "/" .. tostring(c:CanChangeIntoAttributeRush(ATTRIBUTE_LIGHT)))
      local race=Effect.CreateEffect(c)
      race:SetType(EFFECT_TYPE_SINGLE)
      race:SetCode(EFFECT_CHANGE_RACE)
      race:SetValue(RACE_DRAGON)
      race:SetReset(RESET_PHASE+PHASE_END,1)
      c:RegisterEffect(race)
      local attribute=Effect.CreateEffect(c)
      attribute:SetType(EFFECT_TYPE_SINGLE)
      attribute:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      attribute:SetValue(ATTRIBUTE_DARK)
      attribute:SetReset(RESET_PHASE+PHASE_END,1)
      c:RegisterEffect(attribute)
      Debug.Message("rush race change " .. tostring(c:CanChangeIntoTypeRush(RACE_DRAGON)) .. "/" .. tostring(c:CanChangeIntoTypeRush(RACE_DRAGON,2)) .. "/" .. tostring(c:CanChangeIntoTypeRush(RACE_SPELLCASTER)) .. "/" .. tostring(c:CanChangeIntoTypeRush(RACE_WARRIOR)))
      Debug.Message("rush attribute change " .. tostring(c:CanChangeIntoAttributeRush(ATTRIBUTE_DARK)) .. "/" .. tostring(c:CanChangeIntoAttributeRush(ATTRIBUTE_DARK,2)) .. "/" .. tostring(c:CanChangeIntoAttributeRush(ATTRIBUTE_LIGHT)) .. "/" .. tostring(c:CanChangeIntoAttributeRush(ATTRIBUTE_FIRE)))
      `,
      "rush-trait-change.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "rush original traits false/false",
      "rush race change false/true/true/true",
      "rush attribute change false/true/true/true",
    ]);
  });

  it("checks Lua sequence movement adjacency conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Blocked", kind: "monster" },
      { code: "200", name: "Middle", kind: "monster" },
    ];
    const session = createDuel({ seed: 91, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const blocked = session.state.cards.find((card) => card.code === "100");
    const middle = session.state.cards.find((card) => card.code === "200");
    expect(blocked).toBeTruthy();
    expect(middle).toBeTruthy();
    moveDuelCard(session.state, blocked!.uid, "monsterZone", 0).sequence = 0;
    moveDuelCard(session.state, middle!.uid, "monsterZone", 0).sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local blocked=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local middle=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      Debug.Message("seqmovcon " .. tostring(aux.seqmovcon(Effect.CreateEffect(middle))) .. "/" .. tostring(aux.seqmovcon(Effect.CreateEffect(blocked))))
      `,
      "seqmovcon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("seqmovcon true/false");
  });

  it("lets Lua scripts move a monster to an adjacent open zone", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Sequence Mover", kind: "monster" },
      { code: "200", name: "Left Blocker", kind: "monster" },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const blocker = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(blocker).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, blocker!.uid, "monsterZone", 0);
    mover!.sequence = 2;
    blocker!.sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mover=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(mover)
      Debug.Message("select adjacent " .. mover:SelectAdjacent(0))
      aux.seqmovop(e,0)
      Debug.Message("seq after op " .. mover:GetSequence() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "seqmovop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("select adjacent 3");
    expect(host.messages).toContain("seq after op 3/100");
  });

  it("keeps adjacent movement helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Sequence Mover", kind: "monster" },
      { code: "200", name: "Ended Left Blocker", kind: "monster" },
    ];
    const session = createDuel({ seed: 206, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const blocker = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(blocker).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, blocker!.uid, "monsterZone", 0);
    mover!.sequence = 2;
    blocker!.sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mover=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(mover)
      Duel.Win(0,WIN_REASON_EXODIA)
      aux.seqmovop(e,0)
      Debug.Message("seq ended " .. mover:GetSequence() .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-seqmovop-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["seq ended 2/0"]);
    expect(session.state.status).toBe("ended");
    expect(mover!.sequence).toBe(2);
  });

  it("lets Lua scripts check additional summon availability", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Summon Source", kind: "monster" },
      { code: "200", name: "Zone Filler A", kind: "monster" },
      { code: "300", name: "Zone Filler B", kind: "monster" },
      { code: "400", name: "Zone Filler C", kind: "monster" },
      { code: "500", name: "Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 31, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      Debug.Message("additional before " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)) .. "/" .. tostring(Duel.IsPlayerCanAdditionalSummon(1)))
      `,
      "additional-summon-before.lua",
    );
    expect(before.ok, before.error).toBe(true);

    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_EXTRA_SUMMON_COUNT)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "additional-summon-effect.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const withEffect = host.loadScript(
      `
      Debug.Message("additional with effect " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)))
      `,
      "additional-summon-with-effect.lua",
    );
    expect(withEffect.ok, withEffect.error).toBe(true);

    for (const code of ["200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const fullZone = host.loadScript(
      `
      Debug.Message("additional full zone " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)))
      `,
      "additional-summon-full-zone.lua",
    );

    expect(fullZone.ok, fullZone.error).toBe(true);
    expect(host.messages).toContain("additional before true/false");
    expect(host.messages).toContain("additional with effect false");
    expect(host.messages).toContain("additional full zone false");
  });

  it("exposes summon type metadata to Lua card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon A", kind: "monster" },
      { code: "300", name: "Summon B", kind: "monster" },
      { code: "900", name: "Summon Fusion", kind: "extra", typeFlags: 0x41, fusionMaterials: ["100", "300"] },
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
    applyAndAssert(session, normal!);

    const host = createLuaScriptHost(session);
    const normalResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("phase activity after summon " .. tostring(Duel.CheckPhaseActivity()))
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. tostring(c:IsNormalSummoned()) .. "/" .. c:GetSummonType())
      Debug.Message("normal phase/materials " .. c:GetSummonPhase() .. "/" .. tostring(c:IsSummonPhase(PHASE_MAIN1)) .. "/" .. tostring(c:IsSummonPhase(PHASE_END,PHASE_MAIN1)) .. "/" .. tostring(c:IsSummonPhase({PHASE_END,PHASE_MAIN1})) .. "/" .. tostring(c:IsSummonPhase(PHASE_END)) .. "/" .. tostring(c:IsSummonPhaseMain()) .. "/" .. tostring(c:IsSummonPhaseBattle()) .. "/" .. c:GetMaterialCount() .. "/" .. c:GetMaterialCountRush())
      Debug.Message("normal location " .. tostring(c:IsSummonLocation(LOCATION_HAND)) .. "/" .. tostring(c:IsSummonLocation(LOCATION_EXTRA,LOCATION_HAND)) .. "/" .. tostring(c:IsSummonLocation({LOCATION_EXTRA,LOCATION_HAND})) .. "/" .. tostring(c:IsSummonLocation(LOCATION_EXTRA)))
      Debug.Message("normal player/type " .. c:GetSummonPlayer() .. "/" .. tostring(c:IsMonsterCard()) .. "/" .. tostring(c:IsFusionMonster()))
      Debug.Message("normal special " .. tostring(c:IsSpecialSummoned()))
      Debug.Message("normal status " .. tostring(c:IsStatus(STATUS_SUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_SPSUMMON_TURN,STATUS_SUMMON_TURN)) .. "/" .. tostring(c:IsStatus({STATUS_SPSUMMON_TURN,STATUS_SUMMON_TURN})) .. "/" .. tostring(c:IsStatus(STATUS_SPSUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_PROC_COMPLETE)) .. "/" .. tostring(c:IsStatus(STATUS_EFFECT_ENABLED)) .. "/" .. tostring(c:IsStatus(STATUS_NO_LEVEL)))
      Debug.Message("normal activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("phase activity after summon true");
    expect(host.messages).toContain("normal type true/true/268435456");
    expect(host.messages).toContain("normal phase/materials 4/true/true/true/false/true/false/0/0");
    expect(host.messages).toContain("normal location true/true/true/false");
    expect(host.messages).toContain("normal player/type 0/true/false");
    expect(host.messages).toContain("normal special false");
    expect(host.messages).toContain("normal status true/true/true/false/true/true/true");
    expect(host.messages).toContain("normal activity 1/1/0");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    applyAndAssert(session, fusion!);
    const fusionCard = session.state.cards.find((card) => card.code === "900");
    expect(fusionCard?.summonType).toBe("fusion");

    const fusionPredicateResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion predicates " .. tostring(c:IsFusionSummoned()) .. "/" .. tostring(c:IsSpecialSummoned()) .. "/" .. tostring(c:IsRitualSummoned()))
      `,
      "summon-type-predicates.lua",
    );
    expect(fusionPredicateResult.ok, fusionPredicateResult.error).toBe(true);
    expect(host.messages).toContain("fusion predicates true/true/false");

    const reincarnationResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("reincarnation before " .. tostring(c:IsReincarnationSummoned()))
      c:RegisterFlagEffect(1295111, RESET_EVENT|RESETS_STANDARD, 0, 1, c:GetSummonPlayer()+1)
      Debug.Message("reincarnation after " .. tostring(c:IsReincarnationSummoned()))
      `,
      "summon-type-reincarnation.lua",
    );
    expect(reincarnationResult.ok, reincarnationResult.error).toBe(true);
    expect(host.messages).toContain("reincarnation before false");
    expect(host.messages).toContain("reincarnation after true");

    fusionCard!.summonTypeCode = 0x40000000 + 151;

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)) .. "/" .. tostring(c:IsSummonType({SUMMON_TYPE_RITUAL,SUMMON_TYPE_SPECIAL})) .. "/" .. tostring(c:IsSummonType({SUMMON_TYPE_RITUAL,SUMMON_TYPE_SYNCHRO})))
      Debug.Message("fusion phase/materials " .. c:GetSummonPhase() .. "/" .. tostring(c:IsSummonPhase(PHASE_MAIN1)) .. "/" .. tostring(c:IsSummonPhase(PHASE_END,PHASE_MAIN1)) .. "/" .. tostring(c:IsSummonPhase({PHASE_END,PHASE_MAIN1})) .. "/" .. tostring(c:IsSummonPhase(PHASE_END)) .. "/" .. tostring(c:IsSummonPhaseMain()) .. "/" .. tostring(c:IsSummonPhaseBattle()) .. "/" .. c:GetMaterialCount() .. "/" .. c:GetMaterialCountRush())
      Debug.Message("fusion location " .. tostring(c:IsSummonLocation(LOCATION_EXTRA)) .. "/" .. tostring(c:IsSummonLocation(LOCATION_HAND,LOCATION_EXTRA)) .. "/" .. tostring(c:IsSummonLocation({LOCATION_HAND,LOCATION_EXTRA})) .. "/" .. tostring(c:IsSummonLocation(LOCATION_HAND)))
      Debug.Message("fusion player/type " .. c:GetSummonPlayer() .. "/" .. tostring(c:IsMonsterCard()) .. "/" .. tostring(c:IsFusionMonster()))
      Debug.Message("fusion special " .. tostring(c:IsSpecialSummoned()) .. "/" .. tostring(c:IsFusionSummoned()) .. "/" .. tostring(c:IsRitualSummoned()))
      local e=Effect.CreateEffect(c)
      Debug.Message("custom summon type " .. c:GetSummonType() .. "/" .. tostring(aux.evospcon(e)) .. "/" .. tostring(aux.gbspcon(e)))
      Debug.Message("fusion status " .. tostring(c:IsStatus(STATUS_SUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_SPSUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_PROC_COMPLETE)))
      Debug.Message("fusion activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type false/true/true/false");
    expect(host.messages).toContain("fusion phase/materials 4/true/true/true/false/true/false/2/2");
    expect(host.messages).toContain("fusion location true/true/true/false");
    expect(host.messages).toContain("fusion player/type 0/true/true");
    expect(host.messages).toContain("fusion special true/false/false");
    expect(host.messages).toContain("custom summon type 1073741975/true/false");
    expect(host.messages).toContain("fusion status false/true/true");
    expect(host.messages).toContain("fusion activity 2/1/1");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);

    fusionCard!.summonTypeCode = 0x40000000 + 120;
    const gladiatorResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Debug.Message("gladiator summon type " .. c:GetSummonType() .. "/" .. tostring(aux.evospcon(e)) .. "/" .. tostring(aux.gbspcon(e)))
      `,
      "summon-type-gladiator.lua",
    );
    expect(gladiatorResult.ok, gladiatorResult.error).toBe(true);
    expect(host.messages).toContain("gladiator summon type 1073741944/false/true");

    fusionCard!.summonTypeCode = 0x12000000;
    const geminiResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("gemini summon type " .. c:GetSummonType() .. "/" .. tostring(c:IsGeminiSummoned()) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_GEMINI)))
      `,
      "summon-type-gemini.lua",
    );
    expect(geminiResult.ok, geminiResult.error).toBe(true);
    expect(host.messages).toContain("gemini summon type 301989888/true/true");

    fusionCard!.summonTypeCode = 0x11000000 + 100;
    const rushMaterialResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("rush material count " .. c:GetMaterialCount() .. "/" .. c:GetMaterialCountRush())
      `,
      "summon-material-rush.lua",
    );
    expect(rushMaterialResult.ok, rushMaterialResult.error).toBe(true);
    expect(host.messages).toContain("rush material count 2/3");

    const phase = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase");
    expect(phase).toBeDefined();
    applyAndAssert(session, phase!);
    const phaseResult = host.loadScript(
      `
      Debug.Message("phase activity after change " .. tostring(Duel.CheckPhaseActivity()))
      `,
      "phase-activity-reset.lua",
    );
    expect(phaseResult.ok, phaseResult.error).toBe(true);
    expect(host.messages).toContain("phase activity after change false");
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
