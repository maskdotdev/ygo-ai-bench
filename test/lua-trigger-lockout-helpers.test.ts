import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
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

  it("applies field cannot-trigger target ranges as location masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Lock Source", kind: "monster", level: 4 },
      { code: "200", name: "Locked Zone Trigger", kind: "monster", level: 4 },
      { code: "300", name: "Open Monster Trigger", kind: "monster", level: 4 },
      { code: "400", name: "Summon Event Source", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 217, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TRIGGER)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(LOCATION_SZONE,0)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_SZONE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("locked zone trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("open monster trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-trigger-location-range.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const lockSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const locked = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const open = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    expect(lockSource).toBeDefined();
    expect(locked).toBeDefined();
    expect(open).toBeDefined();
    expect(summoned).toBeDefined();
    moveDuelCard(session.state, lockSource!.uid, "monsterZone", 0);
    moveDuelCard(session.state, locked!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, open!.uid, "monsterZone", 0);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    expect(session.state.pendingTriggers.map((trigger) => trigger.sourceUid)).toEqual([open!.uid]);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === session.state.pendingTriggers[0]?.effectId);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toEqual(["open monster trigger resolved"]);
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
