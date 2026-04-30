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
      Debug.Message("affected self " .. tostring(self_effect ~= nil) .. "/" .. self_effect:GetLabel())
      Debug.Message("affected opp " .. tostring(opp_effect ~= nil) .. "/" .. opp_effect:GetLabel())
      Debug.Message("affected excluded " .. tostring(Duel.IsPlayerAffectedByEffect(1,777001)))
      Debug.Message("affected missing " .. tostring(Duel.IsPlayerAffectedByEffect(0,777003)))
      `,
      "player-affected-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("affected self true/11");
    expect(host.messages).toContain("affected opp true/22");
    expect(host.messages).toContain("affected excluded nil");
    expect(host.messages).toContain("affected missing nil");
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
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "graveyard", reason: 0x4000001 });
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
