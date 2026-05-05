import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua break-effect events", () => {
  it("queues break-effect triggers when Lua marks an operation boundary", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Break Source", kind: "monster" },
      { code: "200", name: "Break Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 201, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
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
          Debug.Message("before break")
          Duel.BreakEffect()
          Debug.Message("after break")
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BREAK_EFFECT)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("break resolved " .. tp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "break-effect-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("before break");
    expect(host.messages).toContain("after break");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["breakEffect"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1050 });
    expect(session.state.eventHistory).toEqual([
      expect.objectContaining({ eventName: "chainActivating", eventCode: 1021 }),
      expect.objectContaining({ eventName: "chaining", eventCode: 1027 }),
      expect.objectContaining({ eventName: "chainSolving", eventCode: 1020 }),
      expect.objectContaining({ eventName: "breakEffect", eventCode: 1050 }),
      expect.objectContaining({ eventName: "chainSolved", eventCode: 1022 }),
    ]);
  });

  it("keeps operation event helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Ended Event Source", kind: "monster" }];
    const session = createDuel({ seed: 202, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.BreakEffect()
      Duel.AdjustInstantly(source)
      Duel.Readjust()
      Duel.RaiseSingleEvent(source, EVENT_BREAK_EFFECT, nil, 0, 0, 0, 0)
      `,
      "ended-operation-events.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.log.filter((entry) => entry.action === "breakEffect" || entry.action === "adjust")).toEqual([]);
    expect(session.state.eventHistory.map((event) => event.eventName)).not.toContain("breakEffect");
    expect(session.state.eventHistory.map((event) => event.eventName)).not.toContain("adjust");
  });
});
