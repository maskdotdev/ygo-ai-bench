import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain-solving events", () => {
  it("queues chain-solving triggers with the resolving chain source as event card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Starter", kind: "monster" },
      { code: "200", name: "Chain Solving Watcher", kind: "monster" },
      { code: "300", name: "Open Response", kind: "monster" },
    ];
    const session = createDuel({ seed: 188, startingHandSize: 2, cardReader: createCardReader(cards) });
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
        e:SetCode(EVENT_CHAIN_SOLVING)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return eg and eg:IsExists(function(tc) return tc:IsCode(100) end,1,nil)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("chain solving resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. rp)
          Debug.Message("chain solving related effect " .. tostring(re~=nil and re:GetHandler():IsCode(100)))
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
    const originalPassPreapply = applyLuaRestoreResponse(restoredChain, originalPass!);
    expect(originalPassPreapply.ok).toBe(false);
    expect(originalPassPreapply.error).toContain("Response is not currently legal");
    assertLuaRestoreLegalWindow(restoredChain, originalPassPreapply, 1);
    applyLuaRestoreAndAssert(restoredChain, restoredPass!);
    expect(restoredChain.host.messages).toContain("starter resolved");
    expect(restoredChain.host.messages).not.toContain("unexpected response");
    expect(restoredChain.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainSolving"]);

    const pass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);

    expect(host.messages).toContain("starter resolved");
    expect(host.messages).not.toContain("unexpected response");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainSolving"]);
    const chainSolvingTrigger = session.state.pendingTriggers[0]!;
    expect(chainSolvingTrigger).toMatchObject({ eventCode: 1020, eventPlayer: 0, eventValue: 1, eventChainDepth: 1, eventReasonPlayer: 0, relatedEffectId: 1 });
    expect(chainSolvingTrigger.eventChainLinkId).toMatch(/^chain-/);
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "chainSolving", eventCode: 1020, eventPlayer: 0, eventValue: 1, eventChainDepth: 1, eventChainLinkId: chainSolvingTrigger.eventChainLinkId, eventReasonPlayer: 0, relatedEffectId: 1 })]));
    expect(session.state.eventHistory.map((event) => event.eventName)).toEqual(["chainActivating", "chaining", "chainSolving", "chainSolved"]);
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
    expectLuaRestoreStalePreapply(restored, trigger!, 0);
    applyLuaRestoreAndAssert(restored, trigger!);
    while (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const chainPass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
      expect(chainPass).toBeDefined();
      expectLuaRestoreStalePreapply(restored, chainPass!, player);
      applyLuaRestoreAndAssert(restored, chainPass!);
    }
    expect(restored.host.messages).toContain("chain solving resolved 0/0/1/0");
    expect(restored.host.messages).toContain("chain solving related effect true");
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
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function expectLuaRestoreStalePreapply(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const response = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(response.ok).toBe(false);
  expect(response.error).toContain("Response is not currently legal");
  expect(response.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  assertLuaRestoreLegalWindow(restored, response, player);
}

function assertLuaRestoreLegalWindow(restored: Parameters<typeof applyLuaRestoreResponse>[0], response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}
