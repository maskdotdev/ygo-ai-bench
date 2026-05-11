import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua continuous effects", () => {
  it("checks whether cards are immune to Lua effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Immune Monster", kind: "monster" },
      { code: "200", name: "Effect Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 73, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        immune_target=c
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          Debug.Message("immune value " .. te:GetOwnerPlayer())
          return te:GetOwnerPlayer()==1
        end)
        c:RegisterEffect(e)
      end
      `,
      "immune-effect-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local target = immune_target
      local opponent_effect = Effect.CreateEffect(target)
      opponent_effect:SetOwnerPlayer(1)
      local own_effect = Effect.CreateEffect(target)
      own_effect:SetOwnerPlayer(0)
      local ignore_effect = Effect.CreateEffect(target)
      ignore_effect:SetOwnerPlayer(1)
      ignore_effect:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      Debug.Message("immune opponent " .. tostring(target:IsImmuneToEffect(opponent_effect)))
      Debug.Message("immune own " .. tostring(target:IsImmuneToEffect(own_effect)))
      Debug.Message("immune ignored " .. tostring(target:IsImmuneToEffect(ignore_effect)))
      Debug.Message("immune nil " .. tostring(target:IsImmuneToEffect(nil)))
      `,
      "immune-effect-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("immune opponent true");
    expect(host.messages).toContain("immune own false");
    expect(host.messages).toContain("immune ignored false");
    expect(host.messages).toContain("immune nil false");
    expect(host.messages).toContain("immune value 1");
    expect(host.messages).toContain("immune value 0");
  });

  it("applies field immunity target ranges as location masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Immunity Source", kind: "monster" },
      { code: "200", name: "Protected Opponent Monster", kind: "monster" },
      { code: "300", name: "Protected Opponent Hand", kind: "monster" },
      { code: "400", name: "Own Monster", kind: "monster" },
      { code: "500", name: "Open Opponent Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "400"] },
      1: { main: ["200", "300", "500"] },
    });
    startDuel(session);

    for (const code of ["100", "400"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.faceUp = true;
      card!.position = "faceUpAttack";
    }
    for (const code of ["200", "500"]) {
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
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(0,LOCATION_MZONE)
        e:SetTarget(function(e,tc) return tc:IsCode(200) or tc:IsCode(300) end)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      `,
      "field-immunity-location-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local protected_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local protected_hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local own_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local effect=Effect.CreateEffect(own_monster)
      effect:SetOwnerPlayer(0)
      Debug.Message("field immune protected monster " .. tostring(protected_monster:IsImmuneToEffect(effect)))
      Debug.Message("field immune protected hand " .. tostring(protected_hand:IsImmuneToEffect(effect)))
      Debug.Message("field immune own monster " .. tostring(own_monster:IsImmuneToEffect(effect)))
      Debug.Message("field immune open monster " .. tostring(open_monster:IsImmuneToEffect(effect)))
      `,
      "field-immunity-location-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("field immune protected monster true");
    expect(host.messages).toContain("field immune protected hand false");
    expect(host.messages).toContain("field immune own monster false");
    expect(host.messages).toContain("field immune open monster false");
  });

  it("checks Lua effect targeting restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Lock Source", kind: "monster" },
      { code: "200", name: "Protected Target", kind: "monster" },
      { code: "300", name: "Open Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 81, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(LOCATION_MZONE,0)
        e:SetTarget(function(e,tc) return tc:IsCode(200) end)
        e:SetValue(aux.tgoval)
        c:RegisterEffect(e)
      end
      `,
      "target-lock-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local protected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local effect=Effect.CreateEffect(open)
      effect:SetOwnerPlayer(1)
      local own_effect=Effect.CreateEffect(open)
      own_effect:SetOwnerPlayer(0)
      Debug.Message("can target protected " .. tostring(protected:IsCanBeEffectTarget(effect)))
      Debug.Message("can target protected own " .. tostring(protected:IsCanBeEffectTarget(own_effect)))
      Debug.Message("can target open " .. tostring(open:IsCanBeEffectTarget(effect)))
      Debug.Message("can target protected nil " .. tostring(protected:IsCanBeEffectTarget(nil)))
      `,
      "target-lock-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("can target protected false");
    expect(host.messages).toContain("can target protected own true");
    expect(host.messages).toContain("can target open true");
    expect(host.messages).toContain("can target protected nil true");
  });

  it("applies effect-targeting restrictions target ranges as location masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Lock Source", kind: "monster" },
      { code: "200", name: "Protected Opponent Monster", kind: "monster" },
      { code: "300", name: "Protected Opponent Hand", kind: "monster" },
      { code: "400", name: "Own Monster", kind: "monster" },
      { code: "500", name: "Open Opponent Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 173, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "400"] },
      1: { main: ["200", "300", "500"] },
    });
    startDuel(session);

    for (const code of ["100", "400"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.faceUp = true;
      card!.position = "faceUpAttack";
    }
    for (const code of ["200", "500"]) {
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
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(0,LOCATION_MZONE)
        e:SetTarget(function(e,tc) return tc:IsCode(200) or tc:IsCode(300) end)
        e:SetValue(aux.tgoval)
        c:RegisterEffect(e)
      end
      `,
      "target-lock-location-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local protected_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local protected_hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local own_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local effect=Effect.CreateEffect(own_monster)
      effect:SetOwnerPlayer(1)
      Debug.Message("can target protected monster " .. tostring(protected_monster:IsCanBeEffectTarget(effect)))
      Debug.Message("can target protected hand " .. tostring(protected_hand:IsCanBeEffectTarget(effect)))
      Debug.Message("can target own monster " .. tostring(own_monster:IsCanBeEffectTarget(effect)))
      Debug.Message("can target open monster " .. tostring(open_monster:IsCanBeEffectTarget(effect)))
      `,
      "target-lock-location-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("can target protected monster false");
    expect(host.messages).toContain("can target protected hand true");
    expect(host.messages).toContain("can target own monster true");
    expect(host.messages).toContain("can target open monster true");
  });

  it("returns active Lua effect tables from Card.IsHasEffect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Has Effect Field Source", kind: "monster" },
      { code: "200", name: "Has Effect Self Source", kind: "monster" },
      { code: "300", name: "Has Effect Target", kind: "monster" },
      { code: "400", name: "Has Effect Hand Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 69, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const self = session.state.cards.find((card) => card.code === "200");
    const target = session.state.cards.find((card) => card.code === "300");
    const hand = session.state.cards.find((card) => card.code === "400");
    expect(source).toBeTruthy();
    expect(self).toBeTruthy();
    expect(target).toBeTruthy();
    expect(hand).toBeTruthy();
    for (const card of [source!, self!, target!]) {
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
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_ATTACK)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("has effect condition " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "has-effect-register.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const check = host.loadScript(
      `
      local self=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local self_effect=self:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT)
      local field_effect=target:IsHasEffect(EFFECT_CANNOT_ATTACK)
      local missing_effect=hand:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT)
      Debug.Message("self effect handler " .. self_effect:GetHandler():GetCode())
      Debug.Message("field effect handler " .. field_effect:GetHandler():GetCode())
      Debug.Message("missing effect " .. tostring(missing_effect))
      `,
      "has-effect-check.lua",
    );
    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("self effect handler 200");
    expect(host.messages).toContain("field effect handler 100");
    expect(host.messages).toContain("missing effect nil");
    expect(host.messages).toContain("has effect condition 100");

    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    const inactive = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local inactive_effect=target:IsHasEffect(EFFECT_CANNOT_ATTACK)
      Debug.Message("inactive field effect " .. tostring(inactive_effect))
      `,
      "has-effect-inactive.lua",
    );
    expect(inactive.ok, inactive.error).toBe(true);
    expect(host.messages).toContain("inactive field effect nil");
  });

  it("applies Lua continuous special summon restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restricted Procedure Source", kind: "monster" },
      { code: "900", name: "Special Summon Lock", kind: "monster" },
    ];
    const session = createDuel({ seed: 39, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "900"] },
      1: { main: [] },
    });
    startDuel(session);

    const lock = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "900");
    expect(lock).toBeTruthy();
    moveDuelCard(session.state, lock!.uid, "monsterZone", 0);
    lock!.faceUp = true;
    lock!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        c:RegisterEffect(e)
      end
      c900={}
      function c900.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("special lock checked " .. tp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "special-summon-lock.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    const canResult = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special locked " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, target)))
      `,
      "special-summon-lock-check.lua",
    );

    expect(canResult.ok, canResult.error).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid)).toBe(false);
    expect(host.messages).toContain("can special locked false");
    expect(host.messages).toContain("special lock checked 0");
  });

  it("checks Lua simultaneous special summon count restrictions", () => {
    const cards: DuelCardData[] = [{ code: "900", name: "Spirit Count Lock", kind: "monster" }];
    const session = createDuel({ seed: 89, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const lock = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "900");
    expect(lock).toBeTruthy();
    moveDuelCard(session.state, lock!.uid, "monsterZone", 0);
    lock!.faceUp = true;
    lock!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("count before " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 2)))
      c900={}
      function c900.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(69832741)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "special-summon-count-lock.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const check = host.loadScript(
      `
      Debug.Message("count one " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 1)))
      Debug.Message("count two " .. tostring(Duel.IsPlayerCanSpecialSummonCount(0, 2)))
      Debug.Message("count opponent " .. tostring(Duel.IsPlayerCanSpecialSummonCount(1, 2)))
      `,
      "special-summon-count-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("count before true");
    expect(host.messages).toContain("count one true");
    expect(host.messages).toContain("count two false");
    expect(host.messages).toContain("count opponent true");
  });

  it("checks Lua synthetic monster special summon legality", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "Synthetic Special Lock", kind: "monster" },
      { code: "901", name: "Zone Filler A", kind: "monster" },
      { code: "902", name: "Zone Filler B", kind: "monster" },
      { code: "903", name: "Zone Filler C", kind: "monster" },
      { code: "904", name: "Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 43, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900"] },
      1: { main: ["901", "902", "903", "904"] },
    });
    startDuel(session);

    for (const filler of session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")) {
      moveDuelCard(session.state, filler.uid, "monsterZone", 1);
      filler.faceUp = true;
      filler.position = "faceUpAttack";
    }

    const lock = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "900");
    expect(lock).toBeTruthy();
    moveDuelCard(session.state, lock!.uid, "monsterZone", 0);
    lock!.faceUp = true;
    lock!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const script = `
      c900={}
      function c900.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,c,sump,sumtype)
          Debug.Message("synthetic lock sumtype " .. sumtype)
          return sumtype~=SUMMON_TYPE_SPECIAL+181
        end)
        c:RegisterEffect(e)
      end
      `;
    const result = host.loadScript(script, "c900.lua");
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      Debug.Message("synthetic locked " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,0)))
      Debug.Message("synthetic custom open " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,181)))
      Debug.Message("synthetic opponent open " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,1)))
      Debug.Message("synthetic bad pos " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEDOWN_ATTACK,0)))
      `,
      "synthetic-special-check.lua",
    );
    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("synthetic locked false");
    expect(host.messages).toContain("synthetic custom open true");
    expect(host.messages).toContain("synthetic opponent open true");
    expect(host.messages).toContain("synthetic bad pos false");
    expect(host.messages).toContain("synthetic lock sumtype 1073742005");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c900.lua" ? script : undefined }, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredCheck = restored.host.loadScript(
      `
      Debug.Message("restored synthetic locked " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,0)))
      Debug.Message("restored synthetic custom open " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,181)))
      `,
      "synthetic-special-restored-check.lua",
    );
    expect(restoredCheck.ok, restoredCheck.error).toBe(true);
    expect(restored.host.messages).toContain("restored synthetic locked false");
    expect(restored.host.messages).toContain("restored synthetic custom open true");
  });

  it("lets Lua scripts check whether cards can be special summoned", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Special Check Lock", kind: "monster" },
      { code: "200", name: "Special Check Target", kind: "monster" },
      { code: "300", name: "Special Check Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "300", "300", "300", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special target " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("can special opponent " .. tostring(target:IsCanBeSpecialSummoned(nil,0,1,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("can special bad pos " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEDOWN_ATTACK)))
      `,
      "can-be-special-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("can special target true");
    expect(host.messages).toContain("can special opponent true");
    expect(host.messages).toContain("can special bad pos false");

    for (const filler of session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && card.code === "300").slice(0, 5)) {
      moveDuelCard(session.state, filler.uid, "monsterZone", 0);
    }
    const full = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special full " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      `,
      "can-be-special-full.lua",
    );
    expect(full.ok, full.error).toBe(true);
    expect(host.messages).toContain("can special full false");

    for (const filler of session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "300")) {
      moveDuelCard(session.state, filler.uid, "graveyard", 0);
    }
    const lock = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(lock).toBeTruthy();
    moveDuelCard(session.state, lock!.uid, "monsterZone", 0);
    const register = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "can-be-special-lock.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const blocked = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special locked " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      `,
      "can-be-special-blocked.lua",
    );
    expect(blocked.ok, blocked.error).toBe(true);
    expect(host.messages).toContain("can special locked false");
  });

  it("lets Lua scripts check special summons to a target player's field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Special Check Target", kind: "monster" },
      { code: "200", name: "Own Filler", kind: "monster" },
      { code: "300", name: "Opponent Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "300", "300", "300", "300"] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const ownFiller = session.state.cards.find((card) => card.controller === 0 && card.code === "200");
    expect(target).toBeTruthy();
    expect(ownFiller).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "hand", 0);
    moveDuelCard(session.state, ownFiller!.uid, "monsterZone", 0);
    for (const filler of session.state.cards.filter((card) => card.controller === 1 && card.code === "300")) {
      moveDuelCard(session.state, filler.uid, "monsterZone", 1);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special own open " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK,0)))
      Debug.Message("can special own zone blocked " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK,0,0x1)))
      Debug.Message("can special opponent full " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK,1,0xff)))
      `,
      "can-be-special-target-player.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("can special own open true");
    expect(host.messages).toContain("can special own zone blocked false");
    expect(host.messages).toContain("can special opponent full false");
  });

  it("applies Lua continuous attack restrictions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Locked Attacker", kind: "monster", attack: 1600 }];
    const session = createDuel({ seed: 40, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0);
    attacker!.faceUp = true;
    attacker!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_ATTACK)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("attack lock checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "attack-lock.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)).toBe(false);
    expect(host.messages).toContain("attack lock checked 100");
  });

  it("returns Lua player affected-by-effect matches", () => {
    const cards: DuelCardData[] = [{ code: "900", name: "Player Effect Source", kind: "monster" }];
    const session = createDuel({ seed: 41, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "900");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c900={}
      function c900.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_FIELD)
        e1:SetCode(777001)
        e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e1:SetRange(LOCATION_MZONE)
        e1:SetTargetRange(1,0)
        e1:SetLabel(11)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_FIELD)
        e2:SetCode(777002)
        e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e2:SetRange(LOCATION_MZONE)
        e2:SetTargetRange(0,1)
        e2:SetLabel(22)
        c:RegisterEffect(e2)
      end
      `,
      "player-affected.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const check = host.loadScript(
      `
      local self_effect=Duel.IsPlayerAffectedByEffect(0,777001)
      local opp_effect=Duel.IsPlayerAffectedByEffect(1,777002)
      local self_get=Duel.GetPlayerEffect(0,777001)
      local opp_get=Duel.GetPlayerEffect(1,777002)
      Debug.Message("affected self " .. tostring(self_effect ~= nil) .. "/" .. self_effect:GetLabel())
      Debug.Message("affected opp " .. tostring(opp_effect ~= nil) .. "/" .. opp_effect:GetLabel())
      Debug.Message("get player self " .. tostring(self_get ~= nil) .. "/" .. self_get:GetLabel())
      Debug.Message("get player opp " .. tostring(opp_get ~= nil) .. "/" .. opp_get:GetLabel())
      Debug.Message("affected excluded " .. tostring(Duel.IsPlayerAffectedByEffect(1,777001)))
      Debug.Message("affected missing " .. tostring(Duel.IsPlayerAffectedByEffect(0,777003)))
      Debug.Message("get player missing " .. tostring(Duel.GetPlayerEffect(0,777003)))
      `,
      "player-affected-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("affected self true/11");
    expect(host.messages).toContain("affected opp true/22");
    expect(host.messages).toContain("get player self true/11");
    expect(host.messages).toContain("get player opp true/22");
    expect(host.messages).toContain("affected excluded nil");
    expect(host.messages).toContain("affected missing nil");
    expect(host.messages).toContain("get player missing nil");

    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    const inactive = host.loadScript(
      `
      Debug.Message("get player inactive " .. tostring(Duel.GetPlayerEffect(0,777001)))
      `,
      "player-effect-inactive.lua",
    );

    expect(inactive.ok, inactive.error).toBe(true);
    expect(host.messages).toContain("get player inactive nil");
  });

  it("registers Lua duel-level player effects", () => {
    const cards: DuelCardData[] = [{ code: "901", name: "Duel Effect Source", kind: "monster" }];
    const session = createDuel({ seed: 42, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["901"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "901");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c901={}
      function c901.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(777004)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetLabel(44)
        Debug.Message("registered duel effect " .. tostring(Duel.RegisterEffect(e,0)))
      end
      `,
      "duel-register-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const check = host.loadScript(
      `
      local effect=Duel.IsPlayerAffectedByEffect(0,777004)
      Debug.Message("duel effect affected " .. tostring(effect ~= nil) .. "/" .. effect:GetLabel())
      Debug.Message("duel effect owner " .. effect:GetOwnerPlayer())
      `,
      "duel-register-effect-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("registered duel effect true");
    expect(host.messages).toContain("duel effect affected true/44");
    expect(host.messages).toContain("duel effect owner 0");
  });

  it("lets Lua scripts query environment-changing player effects", () => {
    const cards: DuelCardData[] = [{ code: "902", name: "Environment Effect Source", kind: "monster" }];
    const session = createDuel({ seed: 74, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["902"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "902");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c902={}
      function c902.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CHANGE_ENVIRONMENT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(777005)
        c:RegisterEffect(e)
      end
      `,
      "environment-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const check = host.loadScript(
      `
      Debug.Message("environment effect self " .. tostring(Duel.IsEnvironment(777005, 0)))
      Debug.Message("environment effect opp " .. tostring(Duel.IsEnvironment(777005, 1)))
      Debug.Message("environment effect all " .. tostring(Duel.IsEnvironment(777005, PLAYER_ALL)))
      `,
      "environment-effect-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("environment effect self true");
    expect(host.messages).toContain("environment effect opp false");
    expect(host.messages).toContain("environment effect all true");

    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    const inactive = host.loadScript(
      `
      Debug.Message("environment effect inactive " .. tostring(Duel.IsEnvironment(777005, 0)))
      `,
      "environment-effect-inactive.lua",
    );
    expect(inactive.ok, inactive.error).toBe(true);
    expect(host.messages).toContain("environment effect inactive false");
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
