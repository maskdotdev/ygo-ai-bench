import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain activation events", () => {
  it("queues chain-activating triggers with the chain source as event card", () => {
    expect(runChainEventFixture("EVENT_CHAIN_ACTIVATING")).toEqual([{ eventName: "chainActivating", eventCode: 1021, eventReasonPlayer: 0 }]);
  });

  it("queues chaining triggers with the chain source as event card", () => {
    const events = runChainEventFixture("EVENT_CHAINING");
    expect(events).toEqual([{ eventName: "chaining", eventCode: 1027, eventPlayer: 0, eventValue: 1, eventChainDepth: 1, eventChainLinkId: events[0]!.eventChainLinkId, eventReasonPlayer: 0 }]);
    expect(events[0]!.eventChainLinkId).toMatch(/^chain-/);
  });
});

function runChainEventFixture(eventCode: "EVENT_CHAIN_ACTIVATING" | "EVENT_CHAINING") {
  const cards: DuelCardData[] = [
    { code: "100", name: "Chain Starter", kind: "monster" },
    { code: "200", name: "Chain Event Watcher", kind: "monster" },
  ];
  const session = createDuel({ seed: 187, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200"] },
    1: { main: [] },
  });
  startDuel(session);

  const source = {
    readScript(name: string) {
      if (name === "c100.lua") {
        return `
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
      `;
      }
      if (name === "c200.lua") {
        return `

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(${eventCode})
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return eg and eg:IsExists(function(tc) return tc:IsCode(100) end,1,nil)
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("watcher resolved " .. tp)
        end)
        c:RegisterEffect(e)
      end
      `;
      }
      return undefined;
    },
  };
  const host = createLuaScriptHost(session);
  const starterScript = host.loadCardScript(100, source);
  const watcherScript = host.loadCardScript(200, source);
  expect(starterScript.ok, starterScript.error).toBe(true);
  expect(watcherScript.ok, watcherScript.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
  expect(action).toBeDefined();
  const response = applyResponse(session, action!);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);

  expect(host.messages).toContain("starter resolved");
  const queuedEvents = session.state.pendingTriggers.map((trigger) => ({
    eventName: trigger.eventName,
    eventCode: trigger.eventCode,
    ...(trigger.eventPlayer === undefined ? {} : { eventPlayer: trigger.eventPlayer }),
    ...(trigger.eventValue === undefined ? {} : { eventValue: trigger.eventValue }),
    ...(trigger.eventChainDepth === undefined ? {} : { eventChainDepth: trigger.eventChainDepth }),
    ...(trigger.eventChainLinkId === undefined ? {} : { eventChainLinkId: trigger.eventChainLinkId }),
    ...(trigger.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: trigger.eventReasonPlayer }),
  }));
  expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining(queuedEvents[0] ?? {})]));
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete).toBe(true);
  expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }]);
  expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  applyLuaRestoreAndAssert(restored, trigger!);
  expect(restored.host.messages).toContain("watcher resolved 0");
  return queuedEvents;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}
