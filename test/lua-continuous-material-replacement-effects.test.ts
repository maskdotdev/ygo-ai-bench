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

describe("Lua continuous material and replacement effects", () => {
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

  it("applies Lua targeted field material restrictions to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material Lock Source", kind: "monster" },
      { code: "200", name: "Targeted Material", kind: "monster" },
      { code: "300", name: "Open Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 238, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
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
        e:SetCode(EFFECT_CANNOT_BE_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-material-lock.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const check = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("targeted material predicates " .. tostring(locked:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(open:IsCanBeFusionMaterial(nil)))
      `,
      "targeted-material-lock-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("targeted material predicates false/true");
  });

  it("applies Lua specific extra-deck material restrictions to card material predicates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Synchro Locked Material", kind: "monster" },
      { code: "200", name: "Xyz Locked Material", kind: "monster" },
      { code: "300", name: "Link Locked Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 237, startingHandSize: 3, cardReader: createCardReader(cards) });
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
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_LINK_MATERIAL)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "specific-material-lock-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const check = host.loadScript(
      `
      local synchro_locked = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local xyz_locked = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local link_locked = Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      Debug.Message("synchro material predicates " .. tostring(synchro_locked:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(synchro_locked:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(synchro_locked:IsCanBeLinkMaterial(nil)))
      Debug.Message("xyz material predicates " .. tostring(xyz_locked:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(xyz_locked:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(xyz_locked:IsCanBeLinkMaterial(nil)))
      Debug.Message("link material predicates " .. tostring(link_locked:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(link_locked:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(link_locked:IsCanBeLinkMaterial(nil)))
      `,
      "specific-material-lock-predicate-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("synchro material predicates false/true/true");
    expect(host.messages).toContain("xyz material predicates true/false/true");
    expect(host.messages).toContain("link material predicates true/true/false");
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

  it("falls through declined Lua destroy replacement effects to later candidates", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Declined Replacement Source", kind: "monster" },
      { code: "200", name: "Threatened Monster", kind: "monster" },
      { code: "300", name: "Accepted Replacement Source", kind: "monster" },
      { code: "400", name: "Accepted Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 278, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const threatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const acceptedCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    expect(threatened).toBeTruthy();
    expect(acceptedCost).toBeTruthy();

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
          if chk==0 then return true end
          Debug.Message("first destroy replacement declined")
          return false
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("first destroy replacement op")
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_DESTROY_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 400), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 400), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("second destroy replacement target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          Debug.Message("second destroy replacement op " .. g:GetFirst():GetCode())
          Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `,
      "destroy-replacement-declined-candidate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    destroyDuelCard(session.state, threatened!.uid, 0);

    expect(host.messages).toContain("first destroy replacement declined");
    expect(host.messages).not.toContain("first destroy replacement op");
    expect(host.messages).toContain("second destroy replacement target 1");
    expect(host.messages).toContain("second destroy replacement op 400");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === acceptedCost!.uid)).toMatchObject({ location: "graveyard" });
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

  it("distinguishes non-summon and effect-only Lua release restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Restriction Source", kind: "monster" },
      { code: "200", name: "Effect Release Locked", kind: "monster" },
      { code: "300", name: "Non Summon Release Locked", kind: "monster" },
      { code: "400", name: "Open Release", kind: "monster" },
    ];
    const session = createDuel({ seed: 238, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
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
        e:SetCode(EFFECT_UNRELEASABLE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UNRELEASABLE_NONSUM)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "release-specific-locks.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const check = host.loadScript(
      `
      local effect_locked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local nonsum_locked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local open = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("effect release lock " .. tostring(effect_locked:IsReleasable()) .. "/" .. tostring(effect_locked:IsReleasableByEffect()))
      Debug.Message("nonsum release lock " .. tostring(nonsum_locked:IsReleasable()) .. "/" .. tostring(nonsum_locked:IsReleasableByEffect()))
      Debug.Message("open release lock " .. tostring(open:IsReleasable()) .. "/" .. tostring(open:IsReleasableByEffect()))
      `,
      "release-specific-lock-check.lua",
    );

    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain("effect release lock true/false");
    expect(host.messages).toContain("nonsum release lock false/false");
    expect(host.messages).toContain("open release lock true/true");
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

});
