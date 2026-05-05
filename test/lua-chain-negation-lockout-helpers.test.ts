import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua chain negation lockout helpers", () => {
  it("prevents Lua negation helpers from disabling protected chain links", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Chain Source", kind: "monster", level: 4 },
      { code: "200", name: "Chain Negator", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 218, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("protected source resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CANNOT_DISEFFECT)
        e2:SetRange(LOCATION_HAND)
        c:RegisterEffect(e2)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("negatable " .. tostring(Duel.IsChainNegatable(1)))
          Debug.Message("negated " .. tostring(Duel.NegateEffect(1)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-diseffect.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.map((effect) => effect.code ?? 0)).toContain(13);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const negator = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect");
    expect(negator).toBeDefined();
    expect(applyResponse(session, negator!).ok).toBe(true);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);

    expect(host.messages).toEqual(["negatable false", "negated false", "protected source resolved"]);
  });
});
