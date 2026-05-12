import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain-negated events", () => {
  it("queues Lua chain-negated triggers after a chain link is negated", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Source", kind: "monster" },
      { code: "200", name: "Negator", kind: "monster" },
      { code: "300", name: "Negation Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 183, startingHandSize: 2, cardReader: createCardReader(cards) });
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
          Debug.Message("negated source resolved")
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
          return Duel.GetCurrentChain()>0 and Duel.IsChainNegatable(1)
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("negate result " .. tostring(Duel.NegateEffect(1)))
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
        e:SetCode(EVENT_CHAIN_NEGATED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("chain negated resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. rp)
          Debug.Message("chain negated related effect " .. tostring(re~=nil and re:GetHandler():IsCode(100)))
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
    const negatorScript = host.loadCardScript(200, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(negatorScript.ok, negatorScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const negatorAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(negatorAction).toBeDefined();
    applyAndAssert(session, negatorAction!);
    const originalPass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(originalPass).toBeDefined();

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredChain, 1)).toEqual(getDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    const originalPassPreapply = applyLuaRestoreResponse(restoredChain, originalPass!);
    expect(originalPassPreapply.ok).toBe(false);
    expect(originalPassPreapply.error).toContain("Response is not currently legal");
    expect(originalPassPreapply.legalActions).toEqual(getDuelLegalActions(restoredChain.session, 1));
    assertLuaRestoreLegalWindow(restoredChain, originalPassPreapply, 1);
    while (restoredChain.session.state.chain.length > 0) {
      const player = restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer;
      const pass = getLuaRestoreLegalActions(restoredChain, player).find((candidate) => candidate.type === "passChain");
      expect(pass).toBeDefined();
      expectLuaRestoreStalePreapply(restoredChain, pass!, player);
      applyLuaRestoreAndAssert(restoredChain, pass!);
    }
    expect(restoredChain.host.messages).toContain("negate result true");
    expect(restoredChain.host.messages).not.toContain("negated source resolved");
    expect(restoredChain.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainNegated"]);

    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
      expect(pass).toBeDefined();
      applyAndAssert(session, pass!);
    }

    expect(host.messages).toContain("negate result true");
    expect(host.messages).not.toContain("negated source resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainNegated"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1024, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0, relatedEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "chainNegated", eventCode: 1024, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0, relatedEffectId: 1 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
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
      const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
      expect(pass).toBeDefined();
      expectLuaRestoreStalePreapply(restored, pass!, player);
      applyLuaRestoreAndAssert(restored, pass!);
    }
    expect(restored.host.messages).toContain("chain negated resolved 0/0/1/0");
    expect(restored.host.messages).toContain("chain negated related effect true");
  });
});

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
