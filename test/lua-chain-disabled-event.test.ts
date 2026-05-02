import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua chain-disabled events", () => {
  it("queues Lua chain-disabled triggers after a disabled chain link is skipped", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Disabled Source", kind: "monster" },
      { code: "200", name: "Disabler", kind: "monster" },
      { code: "300", name: "Disable Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 184, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
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
          Debug.Message("disabled source resolved")
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp)
          return Duel.GetCurrentChain()>0 and Duel.IsChainDisablable(1)
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("disable result " .. tostring(Duel.NegateEffect(1)))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHAIN_DISABLED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("chain disabled resolved " .. tp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-disabled-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const disablerAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(disablerAction).toBeDefined();
    expect(applyResponse(session, disablerAction!).ok).toBe(true);
    drainChain(session);

    expect(host.messages).toContain("disable result true");
    expect(host.messages).not.toContain("disabled source resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainDisabled"]);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    drainChain(session);
    expect(host.messages).toContain("chain disabled resolved 0");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}
