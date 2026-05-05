import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua trigger lockout helpers", () => {
  it("suppresses Lua triggers from cards affected by cannot-trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", level: 4 },
      { code: "200", name: "Cannot Trigger Source", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 216, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_TRIGGER_O)
        e1:SetCode(EVENT_SUMMON_SUCCESS)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("locked trigger resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CANNOT_TRIGGER)
        e2:SetRange(LOCATION_HAND)
        c:RegisterEffect(e2)
      end
      `,
      "cannot-trigger.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === session.state.cards.find((card) => card.code === "200")?.uid)).toHaveLength(2);

    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(summoned).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger")).toBe(false);
    expect(host.messages).toEqual([]);
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
