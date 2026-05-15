import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, type LuaSnapshotRestoreResult, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
          Debug.Message("disabled source resolved")
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
      `;
        }
        if (name === "c300.lua") {
          return `

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHAIN_DISABLED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("chain disabled resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. rp)
          Debug.Message("chain disabled related effect " .. tostring(re~=nil and re:GetHandler():IsCode(100)))
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(100, source);
    const disablerScript = host.loadCardScript(200, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(disablerScript.ok, disablerScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const disablerAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(disablerAction).toBeDefined();
    applyAndAssert(session, disablerAction!);
    const originalPass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(originalPass).toBeDefined();

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredChain, 1)).toEqual(getDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    const originalPassPreapply = applyLuaRestoreResponse(restoredChain, originalPass!);
    expect(originalPassPreapply.ok).toBe(false);
    expect(originalPassPreapply.error).toContain("Response is not currently legal");
    expect(originalPassPreapply.legalActions).toEqual(getDuelLegalActions(restoredChain.session, 1));
    assertLuaRestoreLegalWindow(restoredChain, originalPassPreapply, 1);
    drainRestoredChain(restoredChain);
    expect(restoredChain.host.messages).toContain("disable result true");
    expect(restoredChain.host.messages).not.toContain("disabled source resolved");
    expect(restoredChain.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainDisabled"]);

    drainChain(session);

    expect(host.messages).toContain("disable result true");
    expect(host.messages).not.toContain("disabled source resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainDisabled"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1025, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0, relatedEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "chainDisabled", eventCode: 1025, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0, relatedEffectId: 1 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, trigger!, 0);
    applyLuaRestoreAndAssert(restored, trigger!);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("chain disabled resolved 0/0/1/0");
    expect(restored.host.messages).toContain("chain disabled related effect true");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function drainRestoredChain(restored: LuaSnapshotRestoreResult): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expectLuaRestoreStalePreapply(restored, pass!, player);
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyLuaRestoreAndAssert(restored: LuaSnapshotRestoreResult, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, result, result.state.waitingFor!);
  return result;
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function assertLuaRestoreLegalWindow(restored: LuaSnapshotRestoreResult, result: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
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

function expectLuaRestoreStalePreapply(restored: LuaSnapshotRestoreResult, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const result = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Response is not currently legal");
  expect(result.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  assertLuaRestoreLegalWindow(restored, result, player);
}
