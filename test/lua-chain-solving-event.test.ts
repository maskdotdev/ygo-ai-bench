import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua chain-solving events", () => {
  it("queues chain-solving triggers with the resolving chain source as event card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Starter", kind: "monster" },
      { code: "200", name: "Chain Solving Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 188, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("starter resolved")
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHAIN_SOLVING)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return eg and eg:IsExists(function(tc) return tc:IsCode(100) end,1,nil)
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("chain solving resolved " .. tp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-solving-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("starter resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainSolving"]);
    expect(session.state.eventHistory.map((event) => event.eventName)).toEqual(["chainActivating", "chaining", "chainSolving", "chainSolved"]);
  });
});
