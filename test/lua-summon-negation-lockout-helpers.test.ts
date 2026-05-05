import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua summon negation lockout helpers", () => {
  it("prevents Lua summon negation on protected Normal Summons", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Summon", kind: "monster", level: 4 },
      { code: "200", name: "Summon Negator", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 221, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_DISABLE_SUMMON)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
          Debug.Message("negated count " .. Duel.NegateSummon(g:GetFirst()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "summon-negation-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const summoned = session.state.cards.find((card) => card.code === "100");
    expect(summoned).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    session.state.pendingTriggers = [];

    const negate = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("200"));
    expect(negate).toBeDefined();
    expect(applyResponse(session, negate!).ok).toBe(true);

    expect(host.messages).toEqual(["negated count 0"]);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.pendingTriggers).toHaveLength(0);
  });

  it("prevents Lua summon negation on protected inherent Special Summons", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Special Summon", kind: "monster", level: 4 },
      { code: "200", name: "Summon Negator", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 223, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.code === "100");
    expect(protectedCard).toBeDefined();
    moveDuelCard(session.state, protectedCard!.uid, "monsterZone", 0);
    protectedCard!.summonType = "special";
    protectedCard!.summonPlayer = 0;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_DISABLE_SUMMON)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
          Debug.Message("special negate count " .. Duel.NegateSummon(g:GetFirst()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "special-summon-negation-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const negate = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("200"));
    expect(negate).toBeDefined();
    expect(applyResponse(session, negate!).ok).toBe(true);

    expect(host.messages).toEqual(["special negate count 0"]);
    expect(session.state.cards.find((card) => card.uid === protectedCard!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies targeted field summon-negation protection only to selected summons", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Protect Source", kind: "monster", level: 4 },
      { code: "200", name: "Protected Summon", kind: "monster", level: 4 },
      { code: "300", name: "Open Summon", kind: "monster", level: 4 },
      { code: "400", name: "Summon Negator", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 222, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400"] }, 1: { main: [] } });
    startDuel(session);

    const protectedCard = session.state.cards.find((card) => card.code === "200");
    const openCard = session.state.cards.find((card) => card.code === "300");
    expect(protectedCard).toBeDefined();
    expect(openCard).toBeDefined();
    moveDuelCard(session.state, protectedCard!.uid, "monsterZone", 0);
    moveDuelCard(session.state, openCard!.uid, "monsterZone", 0);
    protectedCard!.summonType = "normal";
    protectedCard!.summonPlayer = 0;
    openCard!.summonType = "normal";
    openCard!.summonPlayer = 0;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_DISABLE_SUMMON)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end

      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected_card=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
          local open_card=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,300),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
          Debug.Message("targeted summon negate protected " .. Duel.NegateSummon(protected_card))
          Debug.Message("targeted summon negate open " .. Duel.NegateSummon(open_card))
        end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-summon-negation-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const negate = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("400"));
    expect(negate).toBeDefined();
    expect(applyResponse(session, negate!).ok).toBe(true);

    expect(host.messages).toEqual(["targeted summon negate protected 0", "targeted summon negate open 1"]);
    expect(session.state.cards.find((card) => card.uid === protectedCard!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === openCard!.uid)).toMatchObject({ location: "graveyard" });
  });
});
