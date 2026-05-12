import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const cards: DuelCardData[] = [{ code: "100", name: "Restore Toss Negate Watcher", kind: "monster" }];

describe("Lua random negate restore helpers", () => {
  it("applies restored Lua coin-toss-negate triggers through restore responses", () => {
    const result = runTossNegateRestore("EVENT_TOSS_COIN_NEGATE", 1152, "coinTossNegated", "restored coin negate");
    expect(result.messages).toContain("restored coin negate 100");
  });

  it("applies restored Lua dice-toss-negate triggers through restore responses", () => {
    const result = runTossNegateRestore("EVENT_TOSS_DICE_NEGATE", 1153, "diceTossNegated", "restored dice negate");
    expect(result.messages).toContain("restored dice negate 100");
  });
});

function runTossNegateRestore(eventCode: string, numericCode: number, eventName: "coinTossNegated" | "diceTossNegated", message: string): { messages: string[] } {
  const source = {
    readScript(name: string) {
      if (name !== "c100.lua") return undefined;
      return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(${eventCode})
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("${message} " .. eg:GetFirst():GetCode())
          Debug.Message("${message} reason " .. tostring(r==REASON_EFFECT) .. "/" .. tostring(rp==0))
        end)
        c:RegisterEffect(e)
      end
      `;
    },
  };
  const session = createDuel({ seed: numericCode, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
  startDuel(session);

  const host = createLuaScriptHost(session);
  const loaded = host.loadCardScript(100, source);
  expect(loaded.ok, loaded.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const raise = host.loadScript(
    `
    local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
    Duel.RaiseEvent(watcher, ${eventCode}, nil, REASON_EFFECT, 0, 0, 0)
    `,
    `restore-toss-negate-${numericCode}.lua`,
  );
  expect(raise.ok, raise.error).toBe(true);
  const watcher = session.state.cards.find((card) => card.code === "100");
  expect(watcher).toBeDefined();
  expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual([eventName]);
  expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: numericCode, eventCardUid: watcher!.uid, eventReason: 0x40, eventReasonPlayer: 0 });
  expect(session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonCardUid");
  expect(session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonEffectId");

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual([eventName]);
  expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: numericCode, eventCardUid: watcher!.uid, eventReason: 0x40, eventReasonPlayer: 0 });
  expect(restored.session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonCardUid");
  expect(restored.session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonEffectId");
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  expect(hasGroupedTrigger(restored, 0, trigger!.effectId)).toBe(true);
  const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
  expect(staleTrigger.ok).toBe(false);
  expect(staleTrigger.error).toContain("Response is not currently legal");
  expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
  expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  assertLuaRestoreLegalWindow(restored, staleTrigger, 0);
  expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual([eventName]);
  expect(restored.host.messages).not.toContain(`${message} 100`);
  expect(restored.host.messages).not.toContain(`${message} reason true/true`);

  applyLuaRestoreAndAssert(restored, trigger!);
  expect(restored.host.messages).toContain(`${message} reason true/true`);
  const staleReplay = applyLuaRestoreResponse(restored, trigger!);
  expect(staleReplay.ok).toBe(false);
  expect(staleReplay.error).toContain("Response is not currently legal");
  expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
  expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);

  const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(originalTrigger).toBeDefined();
  applyAndAssert(session, originalTrigger!);
  expect(host.messages).toContain(`${message} 100`);
  return { messages: restored.host.messages };
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
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

function hasGroupedTrigger(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
}
