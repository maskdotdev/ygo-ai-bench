import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua level-up events", () => {
  it("queues level-change triggers when Lua updates a monster level", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Level Source", kind: "monster", level: 4 },
      { code: "200", name: "Level Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 195, startingHandSize: 2, cardReader: createCardReader(cards) });
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
          Debug.Message("level delta " .. e:GetHandler():UpdateLevel(1))
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_LEVEL_UP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("level event " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "level-up-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const source = session.state.cards.find((card) => card.code === "100");
    expect(host.messages).toContain("level delta 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["levelChanged"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: source!.uid });
    expect(session.state.eventHistory.map((event) => event.eventName)).toEqual(["chainActivating", "chaining", "chainSolving", "levelChanged", "chainSolved"]);
  });
});
