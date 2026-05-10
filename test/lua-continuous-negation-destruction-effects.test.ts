import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua continuous negation and destruction effects", () => {
  it("lets Lua scripts query negatable cards and monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Disable Source", kind: "monster" },
      { code: "200", name: "Negatable Monster", kind: "monster" },
      { code: "300", name: "Negatable Spell", kind: "spell" },
      { code: "400", name: "Hand Monster", kind: "monster" },
      { code: "500", name: "Normal Monster", kind: "monster", typeFlags: 0x11 },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const spell = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const normal = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(monster).toBeTruthy();
    expect(spell).toBeTruthy();
    expect(normal).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0);
    moveDuelCard(session.state, normal!.uid, "monsterZone", 0);
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local disable_effect=Effect.CreateEffect(monster)
      Debug.Message("monster negatable " .. tostring(monster:IsNegatable()) .. "/" .. tostring(monster:IsNegatableMonster()) .. "/" .. tostring(monster:IsNegatableSpellTrap()))
      Debug.Message("spell negatable " .. tostring(spell:IsNegatable()) .. "/" .. tostring(spell:IsNegatableMonster()) .. "/" .. tostring(spell:IsNegatableSpellTrap()))
      Debug.Message("hand negatable " .. tostring(hand:IsNegatable()) .. "/" .. tostring(hand:IsNegatableMonster()) .. "/" .. tostring(hand:IsNegatableSpellTrap()))
      Debug.Message("normal negatable " .. tostring(normal:IsNegatable()) .. "/" .. tostring(normal:IsNegatableMonster()) .. "/" .. tostring(normal:IsCanBeDisabledByEffect(disable_effect)))
      Debug.Message("disable by effect " .. tostring(monster:IsCanBeDisabledByEffect(disable_effect)) .. "/" .. tostring(spell:IsCanBeDisabledByEffect(disable_effect)) .. "/" .. tostring(hand:IsCanBeDisabledByEffect(disable_effect)))
      `,
      "negatable-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("monster negatable true/true/false");
    expect(host.messages).toContain("spell negatable true/false/true");
    expect(host.messages).toContain("hand negatable false/false/false");
    expect(host.messages).toContain("normal negatable false/false/false");
    expect(host.messages).toContain("disable by effect true/true/false");

    const register = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_DISABLE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "negatable-disable.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const after = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("monster negatable disabled " .. tostring(monster:IsNegatable()) .. "/" .. tostring(monster:IsNegatableMonster()) .. "/" .. tostring(monster:IsDisabled()))
      `,
      "negatable-after.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("monster negatable disabled false/false/true");
  });

  it("applies targeted field disable effects only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeted Disable Source", kind: "monster" },
      { code: "200", name: "Disabled Target", kind: "monster" },
      { code: "300", name: "Enabled Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 143, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_DISABLE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-disable.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local disabled=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local enabled=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("targeted disabled " .. tostring(disabled:IsDisabled()) .. "/" .. tostring(enabled:IsDisabled()))
      Debug.Message("targeted negatable " .. tostring(disabled:IsNegatable()) .. "/" .. tostring(enabled:IsNegatable()))
      `,
      "targeted-disable-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("targeted disabled true/false");
    expect(host.messages).toContain("targeted negatable false/true");
  });

  it("lets Lua scripts register standard card effect negation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negation Source", kind: "monster" },
      { code: "200", name: "Negation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 71, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local boost=Effect.CreateEffect(target)
      boost:SetType(EFFECT_TYPE_SINGLE)
      boost:SetCode(EFFECT_UPDATE_ATTACK)
      boost:SetValue(500)
      boost:SetReset(RESET_EVENT|RESET_DISABLE)
      target:RegisterEffect(boost)
      Debug.Message("reset disable before " .. tostring(target:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil))
      Debug.Message("negate before " .. tostring(target:IsDisabled()))
      target:NegateEffects(source, RESET_PHASE|PHASE_END, true, 2)
      Debug.Message("negate after " .. tostring(target:IsDisabled()))
      Debug.Message("reset disable after " .. tostring(target:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil))
      `,
      "card-negate-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("reset disable before true");
    expect(host.messages).toContain("negate before false");
    expect(host.messages).toContain("negate after true");
    expect(host.messages).toContain("reset disable after false");
    expect(session.state.effects.some((effect) => effect.sourceUid === target!.uid && effect.code === 2 && effect.reset?.count === 2)).toBe(true);
    expect(session.state.effects.some((effect) => effect.sourceUid === target!.uid && effect.code === 8)).toBe(true);
  });

  it("checks immunity when testing whether Lua cards can be disabled by effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Immune Disable Target", kind: "monster" },
      { code: "200", name: "Disable Probe", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==1
        end)
        c:RegisterEffect(e)
      end
      `,
      "disable-immunity-register.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local own_effect=Effect.CreateEffect(target)
      own_effect:SetOwnerPlayer(0)
      local opponent_effect=Effect.CreateEffect(target)
      opponent_effect:SetOwnerPlayer(1)
      local ignore_effect=Effect.CreateEffect(target)
      ignore_effect:SetOwnerPlayer(1)
      ignore_effect:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      Debug.Message("disable immune " .. tostring(target:IsCanBeDisabledByEffect(own_effect)) .. "/" .. tostring(target:IsCanBeDisabledByEffect(opponent_effect)) .. "/" .. tostring(target:IsCanBeDisabledByEffect(ignore_effect)))
      `,
      "disable-immunity-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("disable immune true/false/true");
  });

  it("checks cannot-disable protection when testing whether Lua cards can be disabled by effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cannot Disable Source", kind: "monster" },
      { code: "200", name: "Protected Disable Target", kind: "monster" },
      { code: "300", name: "Open Disable Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 228, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_DISABLE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "cannot-disable-register.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local disable_effect=Effect.CreateEffect(open)
      Debug.Message("disable protected " .. tostring(protected:IsCanBeDisabledByEffect(disable_effect)))
      Debug.Message("disable open " .. tostring(open:IsCanBeDisabledByEffect(disable_effect)))
      `,
      "cannot-disable-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("disable protected false");
    expect(host.messages).toContain("disable open true");
  });

  it("applies targeted field cannot-disable effects only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeted Cannot Disable Source", kind: "monster" },
      { code: "200", name: "Protected Disable Target", kind: "monster" },
      { code: "300", name: "Open Disable Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 144, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_DISABLE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-cannot-disable.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local disable_effect=Effect.CreateEffect(open)
      Debug.Message("targeted cannot disable " .. tostring(protected:IsCanBeDisabledByEffect(disable_effect)) .. "/" .. tostring(open:IsCanBeDisabledByEffect(disable_effect)))
      protected:NegateEffects(open, RESET_PHASE|PHASE_END, true)
      open:NegateEffects(open, RESET_PHASE|PHASE_END, true)
      Debug.Message("targeted cannot disabled " .. tostring(protected:IsDisabled()) .. "/" .. tostring(open:IsDisabled()))
      `,
      "targeted-cannot-disable-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("targeted cannot disable false/true");
    expect(host.messages).toContain("targeted cannot disabled false/true");
  });

  it("keeps cannot-disable protected cards active after Lua negation helpers resolve", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negation Source", kind: "monster" },
      { code: "200", name: "Protected Negation Target", kind: "monster" },
      { code: "300", name: "Open Negation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 229, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_DISABLE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "cannot-disable-negate-register.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const applyNegation = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("before negation " .. tostring(protected:IsDisabled()) .. "/" .. tostring(open:IsDisabled()))
      protected:NegateEffects(source, RESET_PHASE|PHASE_END, true, 1)
      open:NegateEffects(source, RESET_PHASE|PHASE_END, true, 1)
      Debug.Message("after negation " .. tostring(protected:IsDisabled()) .. "/" .. tostring(open:IsDisabled()))
      `,
      "cannot-disable-negate-apply.lua",
    );

    expect(applyNegation.ok, applyNegation.error).toBe(true);
    expect(host.messages).toContain("before negation false/false");
    expect(host.messages).toContain("after negation false/true");
  });

  it("lets Lua scripts check whether cards can change control", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Monster", kind: "monster" },
      { code: "200", name: "Control Spell", kind: "spell" },
      { code: "300", name: "Control Hand", kind: "monster" },
      { code: "400", name: "Control Filler", kind: "monster" },
      { code: "500", name: "Control Backrow Filler", kind: "spell" },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 10, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400", "400", "400", "500", "500", "500", "500", "500"] },
    });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const spell = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(monster).toBeTruthy();
    expect(spell).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0);
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const open = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("control monster open " .. tostring(monster:IsAbleToChangeControler()) .. "/" .. tostring(monster:IsAbleToChangeControler(0)))
      Debug.Message("control alias open " .. tostring(monster:IsControlerCanBeChanged()) .. "/" .. tostring(monster:IsControlerCanBeChanged(0)))
      Debug.Message("control spell open " .. tostring(spell:IsAbleToChangeControler()))
      Debug.Message("control hand " .. tostring(hand:IsAbleToChangeControler()))
      Debug.Message("control alias hand " .. tostring(hand:IsControlerCanBeChanged()))
      `,
      "control-change-open.lua",
    );
    expect(open.ok, open.error).toBe(true);
    expect(host.messages).toContain("control monster open true/false");
    expect(host.messages).toContain("control alias open true/false");
    expect(host.messages).toContain("control spell open true");
    expect(host.messages).toContain("control hand false");
    expect(host.messages).toContain("control alias hand false");

    for (const filler of session.state.cards.filter((card) => card.controller === 1 && card.location === "hand" && card.code === "400")) {
      moveDuelCard(session.state, filler.uid, "monsterZone", 1);
    }
    for (const filler of session.state.cards.filter((card) => card.controller === 1 && card.location === "hand" && card.code === "500")) {
      moveDuelCard(session.state, filler.uid, "spellTrapZone", 1);
    }

    const full = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("control full " .. tostring(monster:IsAbleToChangeControler()) .. "/" .. tostring(spell:IsAbleToChangeControler()))
      Debug.Message("control alias full " .. tostring(monster:IsControlerCanBeChanged()) .. "/" .. tostring(spell:IsControlerCanBeChanged()))
      `,
      "control-change-full.lua",
    );
    expect(full.ok, full.error).toBe(true);
    expect(host.messages).toContain("control full false/false");
    expect(host.messages).toContain("control alias full false/false");
  });

  it("applies Lua cannot-change-control effects to predicates and operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Lock Source", kind: "monster" },
      { code: "200", name: "Protected Control", kind: "monster" },
      { code: "300", name: "Open Control", kind: "monster" },
      { code: "400", name: "Opponent Swap", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: ["400"] } });
    startDuel(session);

    for (const code of ["100", "200", "300"] as const) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(opponent).toBeTruthy();
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_CHANGE_CONTROL)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-change-control-setup.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("control lock predicates " .. tostring(protected:IsAbleToChangeControler()) .. "/" .. tostring(open:IsAbleToChangeControler()))
      Debug.Message("control lock aliases " .. tostring(protected:IsControlerCanBeChanged()) .. "/" .. tostring(open:IsControlerCanBeChanged()))
      Debug.Message("control lock take " .. Duel.GetControl(protected, 1, 0, 0, LOCATION_MZONE))
      Debug.Message("control open take " .. Duel.GetControl(open, 1, 0, 0, LOCATION_MZONE))
      Debug.Message("control lock swap " .. tostring(Duel.SwapControl(protected, opponent)))
      `,
      "cannot-change-control.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("control lock predicates false/true");
    expect(host.messages).toContain("control lock aliases false/true");
    expect(host.messages).toContain("control lock take 0");
    expect(host.messages).toContain("control open take 1");
    expect(host.messages).toContain("control lock swap false");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ controller: 0 });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ controller: 1 });
    expect(session.state.cards.find((card) => card.code === "400")).toMatchObject({ controller: 1 });
  });

  it("applies Lua indestructible effect destruction prevention", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Indestructible Source", kind: "monster" },
      { code: "200", name: "Protected Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 45, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(protectedCard).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("indestructible checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-indestructible.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const destroyResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("indestructible destroy " .. Duel.Destroy(c, REASON_EFFECT))
      `,
      "effect-indestructible-destroy.lua",
    );

    expect(destroyResult.ok, destroyResult.error).toBe(true);
    expect(host.messages).toContain("indestructible checked 100");
    expect(host.messages).toContain("indestructible destroy 0");
    expect(session.state.cards.find((card) => card.uid === protectedCard!.uid)).toMatchObject({ location: "hand" });
  });

  it("applies targeted field indestructible effects only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeted Indestructible Source", kind: "monster" },
      { code: "200", name: "Protected Target", kind: "monster" },
      { code: "300", name: "Open Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 142, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const openCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(protectedCard).toBeTruthy();
    expect(openCard).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-indestructible-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const destroyResult = host.loadScript(
      `
      local protected_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      local open_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("targeted indestructible protected " .. Duel.Destroy(protected_card, REASON_EFFECT))
      Debug.Message("targeted indestructible open " .. Duel.Destroy(open_card, REASON_EFFECT))
      `,
      "targeted-indestructible-destroy.lua",
    );

    expect(destroyResult.ok, destroyResult.error).toBe(true);
    expect(host.messages).toContain("targeted indestructible protected 0");
    expect(host.messages).toContain("targeted indestructible open 1");
    expect(session.state.cards.find((card) => card.uid === protectedCard!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === openCard!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("lets Lua scripts query destructible cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Destructible Source", kind: "monster" },
      { code: "200", name: "Protected Target", kind: "monster" },
      { code: "300", name: "Open Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const openCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(protectedCard).toBeTruthy();
    expect(openCard).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
        e:SetRange(LOCATION_HAND)
        e:SetValue(aux.indoval)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "destructible-query-setup.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const query = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local opponent_effect=Effect.CreateEffect(open)
      opponent_effect:SetOwnerPlayer(1)
      local own_effect=Effect.CreateEffect(open)
      own_effect:SetOwnerPlayer(0)
      Debug.Message("protected destructible " .. tostring(protected:IsDestructable(opponent_effect)))
      Debug.Message("protected destructible own " .. tostring(protected:IsDestructable(own_effect)))
      Debug.Message("protected destructible nil " .. tostring(protected:IsDestructable()))
      Debug.Message("open destructible " .. tostring(open:IsDestructable()))
      Debug.Message("destructible group " .. Duel.GetMatchingGroupCount(Card.IsDestructable, 0, LOCATION_HAND, 0, nil))
      `,
      "destructible-query.lua",
    );

    expect(query.ok, query.error).toBe(true);
    expect(host.messages).toContain("protected destructible false");
    expect(host.messages).toContain("protected destructible own true");
    expect(host.messages).toContain("protected destructible nil true");
    expect(host.messages).toContain("open destructible true");
    expect(host.messages).toContain("destructible group 3");
  });

  it("treats immune cards as not destructible by matching effects", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Immune Destruction Target", kind: "monster" },
      { code: "300", name: "Open Destruction Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 167, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_HAND)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==1
        end)
        c:RegisterEffect(e)
      end
      `,
      "destructible-immunity-setup.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const query = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local opponent_effect=Effect.CreateEffect(open)
      opponent_effect:SetOwnerPlayer(1)
      local own_effect=Effect.CreateEffect(open)
      own_effect:SetOwnerPlayer(0)
      local ignore_effect=Effect.CreateEffect(open)
      ignore_effect:SetOwnerPlayer(1)
      ignore_effect:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      Debug.Message("immune destructible opponent " .. tostring(protected:IsDestructable(opponent_effect)))
      Debug.Message("immune destructible own " .. tostring(protected:IsDestructable(own_effect)))
      Debug.Message("immune destructible ignored " .. tostring(protected:IsDestructable(ignore_effect)))
      Debug.Message("immune destructible nil " .. tostring(protected:IsDestructable()))
      Debug.Message("open destructible opponent " .. tostring(open:IsDestructable(opponent_effect)))
      `,
      "destructible-immunity-query.lua",
    );

    expect(query.ok, query.error).toBe(true);
    expect(host.messages).toContain("immune destructible opponent false");
    expect(host.messages).toContain("immune destructible own true");
    expect(host.messages).toContain("immune destructible ignored true");
    expect(host.messages).toContain("immune destructible nil true");
    expect(host.messages).toContain("open destructible opponent true");
  });

  it("blocks effect operation movement of immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Movement Effect Source", kind: "monster" },
      { code: "101", name: "Ignore Immunity Source", kind: "monster" },
      { code: "200", name: "Immune Destroy Target", kind: "monster" },
      { code: "201", name: "Immune Send Target", kind: "monster" },
      { code: "300", name: "Open Destroy Target", kind: "monster" },
      { code: "301", name: "Open Send Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 191, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101"] },
      1: { main: ["200", "201", "300", "301"] },
    });
    startDuel(session);

    for (const code of ["200", "201", "300", "301"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 1);
      card!.faceUp = true;
      card!.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected_destroy=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil)
          local protected_send=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 1, LOCATION_MZONE, 0, 1, 1, nil)
          local open_destroy=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 1, LOCATION_MZONE, 0, 1, 1, nil)
          local open_send=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 1, LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("operation destroy protected " .. Duel.Destroy(protected_destroy, REASON_EFFECT))
          Debug.Message("operation send protected " .. Duel.SendtoGrave(protected_send, REASON_EFFECT))
          Debug.Message("operation destroy open " .. Duel.Destroy(open_destroy, REASON_EFFECT))
          Debug.Message("operation send open " .. Duel.SendtoGrave(open_send, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      c101={}
      function c101.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected_destroy=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil)
          local protected_send=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 1, LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("ignore destroy protected " .. Duel.Destroy(protected_destroy, REASON_EFFECT))
          Debug.Message("ignore send protected " .. Duel.SendtoGrave(protected_send, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      local function register_immune(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        register_immune(c)
      end
      c201={}
      function c201.initial_effect(c)
        register_immune(c)
      end
      `,
      "operation-immunity-movement.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "101");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("operation destroy protected 0");
    expect(host.messages).toContain("operation send protected 0");
    expect(host.messages).toContain("operation destroy open 1");
    expect(host.messages).toContain("operation send open 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "201")).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "301")).toMatchObject({ location: "graveyard" });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    const ignoreResult = applyResponse(session, ignoreAction!);
    expect(ignoreResult.ok, ignoreResult.error).toBe(true);
    expect(host.messages).toContain("ignore destroy protected 1");
    expect(host.messages).toContain("ignore send protected 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "201")).toMatchObject({ location: "graveyard" });
  });

  it("applies Lua indestructible value callbacks during destruction", () => {
    const cards: DuelCardData[] = [{ code: "200", name: "Value Protected Target", kind: "monster" }];
    const session = createDuel({ seed: 82, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(protectedCard).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
        e:SetRange(LOCATION_HAND)
        e:SetValue(aux.indoval)
        c:RegisterEffect(e)
      end
      `,
      "indestructible-value-destroy.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const prevented = destroyDuelCard(session.state, protectedCard!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(prevented).toMatchObject({ uid: protectedCard!.uid, location: "hand" });
    const destroyed = destroyDuelCard(session.state, protectedCard!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(destroyed).toMatchObject({ uid: protectedCard!.uid, location: "graveyard" });
  });

  it("consumes Lua counted indestructible effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Count Source", kind: "monster" },
      { code: "200", name: "Count Protected", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(protectedCard).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_INDESTRUCTABLE_COUNT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetValue(1)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("count indestructible checked " .. e:GetValue())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "count-indestructible.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const firstDestroy = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("count destroy first " .. Duel.Destroy(c, REASON_EFFECT))
      `,
      "count-indestructible-first.lua",
    );
    const secondDestroy = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("count destroy second " .. Duel.Destroy(c, REASON_EFFECT))
      `,
      "count-indestructible-second.lua",
    );

    expect(firstDestroy.ok, firstDestroy.error).toBe(true);
    expect(secondDestroy.ok, secondDestroy.error).toBe(true);
    expect(host.messages).toContain("count indestructible checked 1");
    expect(host.messages).toContain("count destroy first 0");
    expect(host.messages).toContain("count destroy second 1");
    expect(session.state.cards.find((card) => card.uid === protectedCard!.uid)).toMatchObject({ location: "graveyard" });
  });

});
