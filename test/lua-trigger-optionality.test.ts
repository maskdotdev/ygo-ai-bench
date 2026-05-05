import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua trigger optionality", () => {
  it("maps Lua trigger optionality from trigger type", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Optionality Summon", kind: "monster" },
      { code: "200", name: "Lua Optional Trigger", kind: "monster" },
      { code: "300", name: "Lua Mandatory Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 87, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("optional trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_F)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("mandatory trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-trigger-optionality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);

    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["lua-2-1100", "lua-1-1100"]);
    expect(summoned.state.pendingTriggers.map((trigger) => session.state.effects.find((effect) => effect.id === trigger.effectId)?.optional)).toEqual([false, true]);
    expect(getDuelLegalActions(session, 0).filter((action) => (action.type === "activateTrigger" || action.type === "declineTrigger") && action.effectId === "lua-1-1100").map((action) => action.type)).toEqual([]);
    expect(getDuelLegalActions(session, 0).filter((action) => (action.type === "activateTrigger" || action.type === "declineTrigger") && action.effectId === "lua-2-1100").map((action) => action.type)).toEqual(["activateTrigger"]);
  });
});
