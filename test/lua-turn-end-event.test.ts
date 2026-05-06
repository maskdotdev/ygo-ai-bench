import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    applyAndAssert(session, endTurn!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "turnEnded", eventCode: 1210 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "turnEnded", eventCode: 1210 })]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
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
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const endTurn = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(endTurn).toBeDefined();
    applyAndAssert(session, endTurn!);
    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.turnPlayer).toBe(1);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["turnEnded"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1210 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["turnEnded"]);
    expect(restored.host.messages).not.toContain("restored turn end 0/1");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored turn end 0/1");
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

function applyLuaRestoreAndAssert(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
