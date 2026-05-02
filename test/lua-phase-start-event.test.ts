import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelPhase } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua phase-start events", () => {
  it("queues Lua phase-start triggers before regular phase triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Phase Start Watcher", kind: "monster" },
      { code: "200", name: "Phase End Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 200, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE_START+PHASE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase start end " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE+PHASE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase end " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-start-end-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    for (const phase of ["battle", "main2", "end"] satisfies DuelPhase[]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action).toBeDefined();
      expect(applyResponse(session, action!).ok).toBe(true);
    }

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseStartEnd", "phaseEnd"]);
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ eventName: "phaseStartEnd", eventCode: 0x2200 }),
      expect.objectContaining({ eventName: "phaseEnd", eventCode: 0x1200 }),
    ]);
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-3)).toEqual(["phaseStartEnd", "phaseChanged", "phaseEnd"]);
    expect(session.state.eventHistory.slice(-3)).toEqual([
      expect.objectContaining({ eventName: "phaseStartEnd", eventCode: 0x2200 }),
      expect.objectContaining({ eventName: "phaseChanged" }),
      expect.objectContaining({ eventName: "phaseEnd", eventCode: 0x1200 }),
    ]);
  });
});
