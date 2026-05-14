import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
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
    expect(events).toEqual([{ eventName: "chaining", eventCode: 1027, eventPlayer: 0, eventValue: 1, eventChainDepth: 1, eventChainLinkId: events[0]!.eventChainLinkId, eventReasonPlayer: 0, relatedEffectId: 1 }]);
    expect(events[0]!.eventChainLinkId).toMatch(/^chain-/);
  });
});

function runChainEventFixture(eventCode: "EVENT_CHAIN_ACTIVATING" | "EVENT_CHAINING") {
  const cards: DuelCardData[] = [
    { code: "100", name: "Chain Starter", kind: "monster" },
    { code: "200", name: "Chain Event Watcher", kind: "monster" },
    { code: "300", name: "Open Response", kind: "monster" },
  ];
  const session = createDuel({ seed: 187, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200"] },
    1: { main: ["300"] },
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
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("watcher resolved " .. tp)
          Debug.Message("watcher related effect " .. tostring(re~=nil and re:GetHandler():IsCode(100)))
        end)
        c:RegisterEffect(e)
      end
      `;
      }
      if (name === "c300.lua") {
        return `

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("unexpected response")
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
  const responseScript = host.loadCardScript(300, source);
  expect(starterScript.ok, starterScript.error).toBe(true);
  expect(watcherScript.ok, watcherScript.error).toBe(true);
  expect(responseScript.ok, responseScript.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);

  const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
  expect(action).toBeDefined();
  applyAndAssert(session, action!);
  const originalPass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
  expect(originalPass).toBeDefined();

  const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActions(restoredChain, 1)).toEqual(getDuelLegalActions(restoredChain.session, 1));
  expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
  expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
  const restoredPass = getLuaRestoreLegalActions(restoredChain, 1).find((candidate) => candidate.type === "passChain");
  expect(restoredPass).toBeDefined();
  expectLuaRestoreStalePreapply(restoredChain, restoredPass!, 1);
  const originalPassPreapply = applyLuaRestoreResponse(restoredChain, originalPass!);
  expect(originalPassPreapply.ok).toBe(false);
  expect(originalPassPreapply.error).toContain("Response is not currently legal");
  assertLuaRestoreLegalWindow(restoredChain, originalPassPreapply, 1);
  applyLuaRestoreAndAssert(restoredChain, restoredPass!);
  expect(restoredChain.host.messages).toContain("starter resolved");
  expect(restoredChain.host.messages).not.toContain("unexpected response");
  expect(restoredChain.session.state.pendingTriggers.map((trigger) => trigger.eventCode)).toContain(eventCode === "EVENT_CHAIN_ACTIVATING" ? 1021 : 1027);

  const pass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
  expect(pass).toBeDefined();
  applyAndAssert(session, pass!);

  expect(host.messages).toContain("starter resolved");
  expect(host.messages).not.toContain("unexpected response");
  const queuedEvents = session.state.pendingTriggers.map((trigger) => ({
    eventName: trigger.eventName,
    eventCode: trigger.eventCode,
    ...(trigger.eventPlayer === undefined ? {} : { eventPlayer: trigger.eventPlayer }),
    ...(trigger.eventValue === undefined ? {} : { eventValue: trigger.eventValue }),
    ...(trigger.eventChainDepth === undefined ? {} : { eventChainDepth: trigger.eventChainDepth }),
    ...(trigger.eventChainLinkId === undefined ? {} : { eventChainLinkId: trigger.eventChainLinkId }),
    ...(trigger.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: trigger.eventReasonPlayer }),
    ...(trigger.relatedEffectId === undefined ? {} : { relatedEffectId: trigger.relatedEffectId }),
  }));
  expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining(queuedEvents[0] ?? {})]));
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }, { ok: true, name: "c300.lua" }]);
  expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  expect(
    getLuaRestoreLegalActionGroups(restored, 0).some(
      (group) =>
        group.windowId === restored.session.state.actionWindowId &&
        group.windowKind === "triggerBucket" &&
        group.actions.some(
          (action) =>
            action.type === "activateTrigger" &&
            action.player === 0 &&
            action.effectId === trigger!.effectId &&
            action.windowId === restored.session.state.actionWindowId &&
            action.windowKind === "triggerBucket",
        ),
    ),
  ).toBe(true);
  expectLuaRestoreStalePreapply(restored, trigger!, 0);
  applyLuaRestoreAndAssert(restored, trigger!);
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const chainPass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(chainPass).toBeDefined();
    expectLuaRestoreStalePreapply(restored, chainPass!, player);
    applyLuaRestoreAndAssert(restored, chainPass!);
  }
  expect(restored.host.messages).toContain("watcher resolved 0");
  if (eventCode === "EVENT_CHAINING") expect(restored.host.messages).toContain("watcher related effect true");
  return queuedEvents;
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function expectLuaRestoreStalePreapply(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const result = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Response is not currently legal");
  expect(result.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  assertLuaRestoreLegalWindow(restored, result, player);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, result, result.state.waitingFor!);
  return result;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, result: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(result.state.actionWindowId).toBe(windowId);
  expect(result.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(result.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(result.state).not.toHaveProperty("triggerOrderPrompt");
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  for (const legalAction of result.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: result.state.windowKind });
  for (const group of result.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: result.state.windowKind });
}
