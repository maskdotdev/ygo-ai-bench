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
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

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
    const result = host.loadScript(
      `
      c900={}
      function c900.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "synthetic-special-lock.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      Debug.Message("synthetic locked " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,0)))
      Debug.Message("synthetic opponent open " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEUP_ATTACK,1)))
      Debug.Message("synthetic bad pos " .. tostring(Duel.IsPlayerCanSpecialSummonMonster(0,123,0,TYPE_MONSTER|TYPE_NORMAL,0,0,1,RACE_WARRIOR,ATTRIBUTE_LIGHT,POS_FACEDOWN_ATTACK,0)))
      `,
      "synthetic-special-check.lua",
    );
    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("synthetic locked false");
    expect(host.messages).toContain("synthetic opponent open true");
    expect(host.messages).toContain("synthetic bad pos false");
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
      `,
      "can-be-special-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("can special target true");
    expect(host.messages).toContain("can special opponent true");

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
      { code: "300", name: "Opponent Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["300", "300", "300", "300", "300"] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    expect(target).toBeTruthy();
    for (const filler of session.state.cards.filter((card) => card.controller === 1 && card.code === "300")) {
      moveDuelCard(session.state, filler.uid, "monsterZone", 1);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can special own open " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK,0)))
      Debug.Message("can special opponent full " .. tostring(target:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK,1,0xff)))
      `,
      "can-be-special-target-player.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("can special own open true");
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
    expect(applyResponse(session, battle!).ok).toBe(true);

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

  it("applies Lua continuous material restrictions to card material predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fusion Locked Material", kind: "monster" },
      { code: "200", name: "Generic Locked Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 57, startingHandSize: 2, cardReader: createCardReader(cards) });
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
        e:SetCode(EFFECT_CANNOT_BE_FUSION_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("fusion material lock checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "material-lock-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const check = host.loadScript(
      `
      local fusion_locked = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local generic_locked = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("fusion material predicates " .. tostring(fusion_locked:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(fusion_locked:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(fusion_locked:IsCanBeRitualMaterial(nil)))
      Debug.Message("generic material predicates " .. tostring(generic_locked:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(generic_locked:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(generic_locked:IsCanBeRitualMaterial(nil)))
      `,
      "material-lock-predicate-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("fusion material predicates false/true/true");
    expect(host.messages).toContain("generic material predicates false/false/false");
    expect(host.messages).toContain("fusion material lock checked 100");
  });

  it("applies Lua continuous graveyard redirect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Redirected Monster", kind: "monster" }];
    const session = createDuel({ seed: 41, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_GRAVE_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "grave-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("send redirected " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "grave-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("redirect checked 100");
    expect(host.messages).toContain("send redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });

  it("applies Lua destroy replacement effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Replacement Source", kind: "monster" },
      { code: "200", name: "Threatened Monster", kind: "monster" },
      { code: "300", name: "Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const threatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_DESTROY_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("destroy replacement target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          local first=g:GetFirst()
          Debug.Message("destroy replacement op " .. first:GetCode())
          Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `,
      "destroy-replacement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, threatened!.uid, 0);

    expect(host.messages).toContain("destroy replacement target 1");
    expect(host.messages).toContain("destroy replacement op 300");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("applies Lua release replacement effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Replacement Source", kind: "monster" },
      { code: "200", name: "Release Threatened", kind: "monster" },
      { code: "300", name: "Release Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 45, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const threatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_RELEASE_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("release replacement target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          Debug.Message("release replacement op " .. g:GetFirst():GetCode())
          Duel.Release(g, REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `,
      "release-replacement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const releaseResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("release replacement result " .. Duel.Release(c, REASON_COST))
      `,
      "release-replacement-run.lua",
    );

    expect(releaseResult.ok, releaseResult.error).toBe(true);
    expect(host.messages).toContain("release replacement target 1");
    expect(host.messages).toContain("release replacement op 300");
    expect(host.messages).toContain("release replacement result 0");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("checks Lua card release-by-effect legality", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Lock", kind: "monster" },
      { code: "200", name: "Protected Release", kind: "monster" },
      { code: "300", name: "Free Release", kind: "monster" },
    ];
    const session = createDuel({ seed: 92, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const lock = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const protectedCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const free = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(lock).toBeTruthy();
    expect(protectedCard).toBeTruthy();
    expect(free).toBeTruthy();
    moveDuelCard(session.state, lock!.uid, "monsterZone", 0);
    moveDuelCard(session.state, protectedCard!.uid, "monsterZone", 0);
    moveDuelCard(session.state, free!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_RELEASE)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "release-by-effect-lock.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const check = host.loadScript(
      `
      local protected_card = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local free = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("releasable cost " .. tostring(protected_card:IsReleasable()) .. "/" .. tostring(free:IsReleasable()))
      Debug.Message("releasable by effect " .. tostring(protected_card:IsReleasableByEffect()) .. "/" .. tostring(free:IsReleasableByEffect()))
      `,
      "release-by-effect-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("releasable cost false/true");
    expect(host.messages).toContain("releasable by effect false/true");
  });

  it("applies Lua send replacement effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Send Replacement Source", kind: "monster" },
      { code: "200", name: "Send Threatened", kind: "monster" },
      { code: "300", name: "Send Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const threatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_SEND_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("send replacement target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          Debug.Message("send replacement op " .. g:GetFirst():GetCode())
          Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `,
      "send-replacement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const sendResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("send replacement result " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "send-replacement-run.lua",
    );

    expect(sendResult.ok, sendResult.error).toBe(true);
    expect(host.messages).toContain("send replacement target 1");
    expect(host.messages).toContain("send replacement op 300");
    expect(host.messages).toContain("send replacement result 0");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("applies Lua cannot-move effects to ability checks and move helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cannot Move Source", kind: "monster" },
      { code: "200", name: "Cannot Grave Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(target).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("cannot grave checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-to-grave.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("cannot grave able " .. tostring(c:IsAbleToGrave()))
      Debug.Message("cannot grave send " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "cannot-to-grave-run.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("cannot grave checked 100");
    expect(host.messages).toContain("cannot grave able false");
    expect(host.messages).toContain("cannot grave send 0");
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "hand" });
  });

  it("lets Lua scripts check whether cards can return to deck or extra deck as cost", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cannot Deck Source", kind: "monster" },
      { code: "200", name: "Main Deck Cost", kind: "monster" },
      { code: "900", name: "Extra Deck Cost", kind: "extra" },
    ];
    const session = createDuel({ seed: 48, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const extraCard = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(extraCard).toBeTruthy();
    moveDuelCard(session.state, extraCard!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local main=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local extra=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("main deck only cost " .. tostring(main:IsAbleToDeckAsCost()))
      Debug.Message("extra deck only cost " .. tostring(extra:IsAbleToDeckAsCost()))
      Debug.Message("main deck cost " .. tostring(main:IsAbleToDeckOrExtraAsCost()))
      Debug.Message("extra deck cost " .. tostring(extra:IsAbleToDeckOrExtraAsCost()))
      `,
      "deck-or-extra-cost-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("main deck only cost true");
    expect(host.messages).toContain("extra deck only cost true");
    expect(host.messages).toContain("main deck cost true");
    expect(host.messages).toContain("extra deck cost true");

    const register = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TO_DECK)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-to-deck.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const after = host.loadScript(
      `
      local main=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local extra=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("main deck only cost blocked " .. tostring(main:IsAbleToDeckAsCost()))
      Debug.Message("extra deck only cost blocked " .. tostring(extra:IsAbleToDeckAsCost()))
      Debug.Message("main deck cost blocked " .. tostring(main:IsAbleToDeckOrExtraAsCost()))
      Debug.Message("extra deck cost blocked " .. tostring(extra:IsAbleToDeckOrExtraAsCost()))
      `,
      "deck-or-extra-cost-after.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("main deck only cost blocked false");
    expect(host.messages).toContain("extra deck only cost blocked false");
    expect(host.messages).toContain("main deck cost blocked false");
    expect(host.messages).toContain("extra deck cost blocked false");
  });

  it("lets Lua scripts check whether cards can be banished as cost", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cannot Banish Source", kind: "monster" },
      { code: "200", name: "Banish Cost Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 49, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("remove cost " .. tostring(c:IsAbleToRemoveAsCost()))
      `,
      "remove-cost-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("remove cost true");

    const register = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_REMOVE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-remove.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const after = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("remove cost blocked " .. tostring(c:IsAbleToRemoveAsCost()))
      `,
      "remove-cost-after.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("remove cost blocked false");
  });

  it("lets Lua scripts query negatable cards and monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Disable Source", kind: "monster" },
      { code: "200", name: "Negatable Monster", kind: "monster" },
      { code: "300", name: "Negatable Spell", kind: "spell" },
      { code: "400", name: "Hand Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const spell = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(monster).toBeTruthy();
    expect(spell).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0);
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local disable_effect=Effect.CreateEffect(monster)
      Debug.Message("monster negatable " .. tostring(monster:IsNegatable()) .. "/" .. tostring(monster:IsNegatableMonster()) .. "/" .. tostring(monster:IsNegatableSpellTrap()))
      Debug.Message("spell negatable " .. tostring(spell:IsNegatable()) .. "/" .. tostring(spell:IsNegatableMonster()) .. "/" .. tostring(spell:IsNegatableSpellTrap()))
      Debug.Message("hand negatable " .. tostring(hand:IsNegatable()) .. "/" .. tostring(hand:IsNegatableMonster()) .. "/" .. tostring(hand:IsNegatableSpellTrap()))
      Debug.Message("disable by effect " .. tostring(monster:IsCanBeDisabledByEffect(disable_effect)) .. "/" .. tostring(spell:IsCanBeDisabledByEffect(disable_effect)) .. "/" .. tostring(hand:IsCanBeDisabledByEffect(disable_effect)))
      `,
      "negatable-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("monster negatable true/true/false");
    expect(host.messages).toContain("spell negatable true/false/true");
    expect(host.messages).toContain("hand negatable false/false/false");
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
      Debug.Message("negate before " .. tostring(target:IsDisabled()))
      target:NegateEffects(source, RESET_PHASE|PHASE_END, true, 2)
      Debug.Message("negate after " .. tostring(target:IsDisabled()))
      `,
      "card-negate-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("negate before false");
    expect(host.messages).toContain("negate after true");
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
      Debug.Message("protected destructible " .. tostring(protected:IsDestructable()))
      Debug.Message("open destructible " .. tostring(open:IsDestructable()))
      Debug.Message("destructible group " .. Duel.GetMatchingGroupCount(Card.IsDestructable, 0, LOCATION_HAND, 0, nil))
      `,
      "destructible-query.lua",
    );

    expect(query.ok, query.error).toBe(true);
    expect(host.messages).toContain("protected destructible false");
    expect(host.messages).toContain("open destructible true");
    expect(host.messages).toContain("destructible group 2");
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

  it("applies Lua continuous banish redirect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Banish Redirected Monster", kind: "monster" }];
    const session = createDuel({ seed: 42, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_REMOVE_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("banish redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "banish-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("banish redirected " .. Duel.Remove(c, POS_FACEUP_ATTACK, REASON_EFFECT))
      `,
      "banish-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("banish redirect checked 100");
    expect(host.messages).toContain("banish redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "graveyard", reason: 0x4000040 });
  });

  it("applies Lua continuous leave-field redirect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Leave Redirected Monster", kind: "monster" }];
    const session = createDuel({ seed: 43, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("leave redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("leave redirected " .. Duel.SendtoHand(c, 0, REASON_EFFECT))
      `,
      "leave-field-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("leave redirect checked 100");
    expect(host.messages).toContain("leave redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });

  it("applies Lua continuous hand and deck redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Redirected Monster", kind: "monster" },
      { code: "200", name: "Deck Redirected Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const handRedirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const deckRedirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(handRedirected).toBeTruthy();
    expect(deckRedirected).toBeTruthy();
    moveDuelCard(session.state, handRedirected!.uid, "monsterZone", 0);
    moveDuelCard(session.state, deckRedirected!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_HAND_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_GRAVE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("hand redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_DECK_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("deck redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "hand-deck-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveResult = host.loadScript(
      `
      local hand_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local deck_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("hand redirected " .. Duel.SendtoHand(hand_card, 0, REASON_EFFECT))
      Debug.Message("deck redirected " .. Duel.SendtoDeck(deck_card, 0, REASON_EFFECT))
      `,
      "hand-deck-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("hand redirect checked 100");
    expect(host.messages).toContain("deck redirect checked 200");
    expect(host.messages).toContain("hand redirected 1");
    expect(host.messages).toContain("deck redirected 1");
    expect(session.state.cards.find((card) => card.uid === handRedirected!.uid)).toMatchObject({ location: "graveyard", reason: 0x4000040 });
    expect(session.state.cards.find((card) => card.uid === deckRedirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });

  it("reports zero when redirected Lua move helpers hit destination restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Blocked Redirect Source", kind: "monster" },
      { code: "200", name: "Blocked Redirect Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 45, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(target).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_HAND_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_GRAVE)
        c:RegisterEffect(e)
      end
      `,
      "blocked-redirected-move.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("blocked redirected hand " .. Duel.SendtoHand(c, 0, REASON_EFFECT))
      `,
      "blocked-redirected-move-run.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("blocked redirected hand 0");
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies Lua player-targeted redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Redirect Source", kind: "monster" },
      { code: "200", name: "Redirected Ally", kind: "monster" },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_TO_GRAVE_REDIRECT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("field redirect checked " .. tp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "field-grave-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("field send redirected " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "field-grave-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("field redirect checked 0");
    expect(host.messages).toContain("field send redirected 1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });
});
