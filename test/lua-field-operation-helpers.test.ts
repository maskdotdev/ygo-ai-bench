import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua field operation helpers", () => {
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

  it("makes earlier Lua optional when triggers miss timing at special summon step boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Step Boundary Source", kind: "monster" },
      { code: "200", name: "Step Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Step Summon Target", kind: "monster" },
      { code: "600", name: "Step Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 95, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local summon_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local summon_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.SpecialSummonStep(summon_target, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
        Duel.SpecialSummonComplete()
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to grave resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to grave resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local summon_effect=Effect.CreateEffect(summon_watcher)
      summon_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      summon_effect:SetCode(EVENT_SPSUMMON_SUCCESS)
      summon_effect:SetRange(LOCATION_HAND)
      summon_effect:SetOperation(function(e,tp)
        Debug.Message("step summon boundary resolved")
      end)
      summon_watcher:RegisterEffect(summon_effect)
      `,
      "special-summon-step-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1102"]));
    const source = session.state.cards.find((card) => card.code === "100");
    const summoned = session.state.cards.find((card) => card.code === "500");
    expect(source).toBeDefined();
    expect(summoned).toBeDefined();
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: summoned!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 })]),
    );
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
    expect(host.messages).toContain("change repeat blocked 1");
    expect(host.messages).toContain("change repeat operated 1");
    expect(host.messages).toContain("change invalid 0");
    expect(host.messages).toContain("change invalid operated 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ position: "faceUpAttack", faceUp: true });
  });

  it("makes Lua optional when position-change triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Position Boundary Source", kind: "monster" },
      { code: "200", name: "Position Boundary Target", kind: "monster" },
      { code: "300", name: "When Position Watcher", kind: "monster" },
      { code: "400", name: "If Position Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 263, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const target = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.ChangePosition(target, POS_FACEUP_DEFENSE)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_CHANGE_POS)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when position resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_CHANGE_POS)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if position resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "change-position-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1016");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1016", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "positionChanged", eventCode: 1016 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]));
  });

  it("allows Lua effect position changes for cards Summoned or Set this turn", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Same Turn Summoned", kind: "monster" },
      { code: "200", name: "Same Turn Set", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    const set = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
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
      Debug.Message("change same turn summoned " .. Duel.ChangePosition(summoned, POS_FACEUP_DEFENSE))
      Debug.Message("change same turn set " .. Duel.ChangePosition(set, POS_FACEUP_ATTACK))
      Debug.Message("change same turn operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "change-position-same-turn-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["change same turn summoned 1", "change same turn set 1", "change same turn operated 1"]);
  });

  it("allows Lua position changes after same-turn lockouts reset", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reset Summoned", kind: "monster" },
      { code: "200", name: "Reset Set", kind: "monster" },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    const set = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
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
      Debug.Message("change reset summoned " .. Duel.ChangePosition(summoned, POS_FACEUP_DEFENSE))
      Debug.Message("change reset set " .. Duel.ChangePosition(set, POS_FACEUP_ATTACK))
      Debug.Message("change reset operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "change-position-next-turn-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["change reset summoned 1", "change reset set 1", "change reset operated 1"]);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === set!.uid)).toMatchObject({ position: "faceUpAttack", faceUp: true });
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

  it("blocks manual Rush position toggles for cards Summoned or Set this turn", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rush Same Turn Summoned", kind: "monster" },
      { code: "200", name: "Rush Same Turn Set", kind: "monster" },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    const set = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
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
      Duel.ChangeToFaceupAttackOrFacedownDefense(summoned, 0)
      Debug.Message("rush same turn summoned " .. summoned:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      Duel.ChangeToFaceupAttackOrFacedownDefense(set, 0)
      Debug.Message("rush same turn set " .. set:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "rush-position-same-turn-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["rush same turn summoned 1/0", "rush same turn set 8/0"]);
  });

  it("allows Rush position toggles after same-turn lockouts reset", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rush Reset Summoned", kind: "monster" },
      { code: "200", name: "Rush Reset Set", kind: "monster" },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    const set = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
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
      Duel.ChangeToFaceupAttackOrFacedownDefense(summoned, 0)
      Debug.Message("rush reset summoned " .. summoned:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      Duel.ChangeToFaceupAttackOrFacedownDefense(set, 0)
      Debug.Message("rush reset set " .. set:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "rush-position-next-turn-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["rush reset summoned 8/1", "rush reset set 1/1"]);
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
      local m0 = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local m1 = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local m2 = Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      local m3 = Duel.GetFieldCard(0, LOCATION_MZONE, 3)
      local m4 = Duel.GetFieldCard(0, LOCATION_MZONE, 4)
      Debug.Message("field mzone codes " .. tostring(m0 and m0:GetCode() or "nil") .. "/" .. tostring(m1 and m1:GetCode() or "nil") .. "/" .. tostring(m2 and m2:GetCode() or "nil") .. "/" .. tostring(m3 and m3:GetCode() or "nil") .. "/" .. tostring(m4 and m4:GetCode() or "nil"))
      Debug.Message("field szone codes " .. Duel.GetFieldCard(0, LOCATION_SZONE, 0):GetCode() .. "/" .. Duel.GetFieldCard(0, LOCATION_SZONE, 1):GetCode())
      Debug.Message("field opponent code " .. Duel.GetFieldCard(1, LOCATION_MZONE, 0):GetCode())
      Debug.Message("field empty cards " .. tostring(Duel.GetFieldCard(0, LOCATION_MZONE, 0) == nil) .. "/" .. tostring(Duel.GetFieldCard(0, LOCATION_MZONE, 3) == nil) .. "/" .. tostring(Duel.GetFieldCard(0, LOCATION_SZONE, 2) == nil))
      `,
      "move-sequence.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("move monster 1");
    expect(host.messages).toContain("move monster operated 1/300");
    expect(host.messages).toContain("monster order 1/2/0");
    expect(host.messages).toContain("move noop 0");
    expect(host.messages).toContain("move noop operated 0");
    expect(host.messages).toContain("move range 1");
    expect(host.messages).toContain("move range operated 1");
    expect(host.messages).toContain("move spelltrap 1");
    expect(host.messages).toContain("spell order 1/0");
    expect(host.messages).toContain("monster order after spell 1/2/4");
    expect(host.messages).toContain("field mzone codes nil/100/200/nil/300");
    expect(host.messages).toContain("field szone codes 500/400");
    expect(host.messages).toContain("field opponent code 600");
    expect(host.messages).toContain("field empty cards true/true/true");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ sequence: 2 });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ sequence: 4 });
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
      local removed_filter = added_cards:Clone():Remove(function(tc,minatk) return tc:GetAttack() >= minatk end, c300, 1500)
      Debug.Message("group remove filter " .. removed_filter:GetCount() .. " " .. tostring(removed_filter:IsContains(c100)) .. "/" .. tostring(removed_filter:IsContains(c200)) .. "/" .. tostring(removed_filter:IsContains(c300)))
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
      local filter_selected = all:FilterSelect(0, function(tc,minatk) return tc:GetAttack() >= minatk end, 1, 2, excluded_group, 1500)
      Debug.Message("filter select " .. filter_selected:GetCount() .. " " .. tostring(filter_selected:IsContains(c200)) .. "/" .. tostring(filter_selected:IsContains(c300)))
      Debug.Message("exists group excluded " .. tostring(all:IsExists(aux.FilterBoolFunction(Card.IsCode, 200), 1, excluded_group)))
      Debug.Message("exists group remainder " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 1, excluded_group, 2500)))
      Debug.Message("match all " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1000):GetCount())
      Debug.Message("match miss " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 1500):GetCount())
      Debug.Message("match excluded " .. all:Clone():Match(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000):GetCount())
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      local attack_classes = all:GetClass(function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetCode()/100 or 0 end, 1500)
      Debug.Message("class values " .. #attack_classes .. "/" .. table.concat(attack_classes,","))
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
    expect(host.messages).toContain("class values 3/2,3,0");
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

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
