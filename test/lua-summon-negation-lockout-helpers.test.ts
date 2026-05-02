import { describe, expect, it } from "vitest";
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
});
