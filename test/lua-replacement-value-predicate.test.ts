import { describe, expect, it } from "vitest";
import { createDuel, destroyDuelCard, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua replacement value predicates", () => {
  it("applies Lua destroy replacement only to cards accepted by SetValue", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Value Predicate Replacement Source", kind: "monster" },
      { code: "200", name: "Protected Threatened Monster", kind: "monster" },
      { code: "201", name: "Unprotected Threatened Monster", kind: "monster" },
      { code: "300", name: "First Replacement Cost", kind: "monster" },
      { code: "301", name: "Second Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 283, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201", "300", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const unprotectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "201");
    const firstCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(protectedThreat).toBeTruthy();
    expect(unprotectedThreat).toBeTruthy();
    expect(firstCost).toBeTruthy();
    expect(secondCost).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s={}
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_DESTROY_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(s.repfilter, tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(s.repfilter, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("value replacement target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetValue(function(e,c)
          Debug.Message("value replacement checked " .. c:GetCode())
          return c:IsCode(200)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          local first=g:Filter(Card.IsCode,nil,300):GetFirst()
          if not first then first=g:GetFirst() end
          Debug.Message("value replacement op " .. first:GetCode())
          Duel.SendtoGrave(Group.FromCards(first), REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      function s.repfilter(c)
        return c:IsCode(300) or c:IsCode(301)
      end
      `,
      "destroy-replacement-value-predicate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    host.messages.splice(0, host.messages.length);

    destroyDuelCard(session.state, unprotectedThreat!.uid, 0);
    expect(host.messages).toContain("value replacement checked 201");
    expect(host.messages).not.toContain("value replacement target 2");
    expect(host.messages).not.toContain("value replacement op 300");
    expect(session.state.cards.find((card) => card.uid === unprotectedThreat!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "hand" });

    destroyDuelCard(session.state, protectedThreat!.uid, 0);
    expect(host.messages).toContain("value replacement checked 200");
    expect(host.messages).toContain("value replacement target 2");
    expect(host.messages).toContain("value replacement op 300");
    expect(session.state.cards.find((card) => card.uid === protectedThreat!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === secondCost!.uid)).toMatchObject({ location: "hand" });
  });

  it("applies Lua release replacement only to cards accepted by SetValue", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Value Predicate Source", kind: "monster" },
      { code: "200", name: "Protected Release Threat", kind: "monster" },
      { code: "201", name: "Unprotected Release Threat", kind: "monster" },
      { code: "300", name: "First Release Replacement Cost", kind: "monster" },
      { code: "301", name: "Second Release Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 284, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201", "300", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const unprotectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "201");
    const firstCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(protectedThreat).toBeTruthy();
    expect(unprotectedThreat).toBeTruthy();
    expect(firstCost).toBeTruthy();
    expect(secondCost).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s={}
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_RELEASE_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(s.repfilter, tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(s.repfilter, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("release value target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetValue(function(e,c)
          Debug.Message("release value checked " .. c:GetCode())
          return c:IsCode(200)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          local first=g:Filter(Card.IsCode,nil,300):GetFirst()
          if not first then first=g:GetFirst() end
          Debug.Message("release value op " .. first:GetCode())
          Duel.Release(Group.FromCards(first), REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      function s.repfilter(c)
        return c:IsCode(300) or c:IsCode(301)
      end
      `,
      "release-replacement-value-predicate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    host.messages.splice(0, host.messages.length);

    const unprotectedRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("release unprotected result " .. Duel.Release(c, REASON_COST))
      `,
      "release-value-unprotected.lua",
    );
    expect(unprotectedRun.ok, unprotectedRun.error).toBe(true);
    expect(host.messages).toContain("release value checked 201");
    expect(host.messages).not.toContain("release value target 2");
    expect(host.messages).not.toContain("release value op 300");
    expect(host.messages).toContain("release unprotected result 1");
    expect(session.state.cards.find((card) => card.uid === unprotectedThreat!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "hand" });

    const protectedRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("release protected result " .. Duel.Release(c, REASON_COST))
      `,
      "release-value-protected.lua",
    );
    expect(protectedRun.ok, protectedRun.error).toBe(true);
    expect(host.messages).toContain("release value checked 200");
    expect(host.messages).toContain("release value target 2");
    expect(host.messages).toContain("release value op 300");
    expect(host.messages).toContain("release protected result 0");
    expect(session.state.cards.find((card) => card.uid === protectedThreat!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === secondCost!.uid)).toMatchObject({ location: "hand" });
  });

  it("applies Lua send replacement only to cards accepted by SetValue", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Send Value Predicate Source", kind: "monster" },
      { code: "200", name: "Protected Send Threat", kind: "monster" },
      { code: "201", name: "Unprotected Send Threat", kind: "monster" },
      { code: "300", name: "First Send Replacement Cost", kind: "monster" },
      { code: "301", name: "Second Send Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 285, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201", "300", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const protectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const unprotectedThreat = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "201");
    const firstCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(protectedThreat).toBeTruthy();
    expect(unprotectedThreat).toBeTruthy();
    expect(firstCost).toBeTruthy();
    expect(secondCost).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s={}
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_SEND_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(s.repfilter, tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
          local g=Duel.GetMatchingGroup(s.repfilter, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("send value target " .. Duel.GetTargetCards():GetCount())
          return true
        end)
        e:SetValue(function(e,c)
          Debug.Message("send value checked " .. c:GetCode())
          return c:IsCode(200)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.GetTargetCards()
          local first=g:Filter(Card.IsCode,nil,300):GetFirst()
          if not first then first=g:GetFirst() end
          Debug.Message("send value op " .. first:GetCode())
          Duel.SendtoGrave(Group.FromCards(first), REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      function s.repfilter(c)
        return c:IsCode(300) or c:IsCode(301)
      end
      `,
      "send-replacement-value-predicate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    host.messages.splice(0, host.messages.length);

    const unprotectedRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("send unprotected result " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "send-value-unprotected.lua",
    );
    expect(unprotectedRun.ok, unprotectedRun.error).toBe(true);
    expect(host.messages).toContain("send value checked 201");
    expect(host.messages).not.toContain("send value target 2");
    expect(host.messages).not.toContain("send value op 300");
    expect(host.messages).toContain("send unprotected result 1");
    expect(session.state.cards.find((card) => card.uid === unprotectedThreat!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "hand" });

    const protectedRun = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("send protected result " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "send-value-protected.lua",
    );
    expect(protectedRun.ok, protectedRun.error).toBe(true);
    expect(host.messages).toContain("send value checked 200");
    expect(host.messages).toContain("send value target 2");
    expect(host.messages).toContain("send value op 300");
    expect(host.messages).toContain("send protected result 0");
    expect(session.state.cards.find((card) => card.uid === protectedThreat!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === firstCost!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === secondCost!.uid)).toMatchObject({ location: "hand" });
  });
});
