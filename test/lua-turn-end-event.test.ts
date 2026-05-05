import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

  it("applies restored Lua turn-end triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Turn End Watcher", kind: "monster" },
      { code: "200", name: "Restore Opponent Draw", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_TURN_END)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored turn end " .. tp .. "/" .. Duel.GetTurnPlayer())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 181, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const endTurn = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(endTurn).toBeDefined();
    expect(applyResponse(session, endTurn!).ok).toBe(true);
    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.turnPlayer).toBe(1);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1210 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored turn end 0/1");
  });
});
