import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua turn-end events", () => {
  it("queues Lua turn-end triggers when a player ends their turn", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn End Watcher", kind: "monster" },
      { code: "200", name: "Opponent Draw", kind: "monster" },
    ];
    const session = createDuel({ seed: 180, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TURN_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("turn end resolved " .. tp .. "/" .. Duel.GetTurnPlayer())
        end)
        c:RegisterEffect(e)
      end
      `,
      "turn-end-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const endTurn = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(endTurn).toBeDefined();
    expect(applyResponse(session, endTurn!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "turnEnded", eventCode: 1210 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "turnEnded", eventCode: 1210 })]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("turn end resolved 0/1");
  });
});
