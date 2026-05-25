import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua predraw events", () => {
  it("queues predraw triggers before the turn draw is applied", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Predraw Watcher", kind: "monster" },
      { code: "200", name: "Turn Draw Card", kind: "monster" },
      { code: "300", name: "Turn Holder", kind: "monster" },
    ];
    const session = createDuel({ seed: 196, startingHandSize: 0, drawPerTurn: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["100", "200"] },
    });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.controller === 1 && card.code === "100");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PREDRAW)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("predraw resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. Duel.GetFieldGroupCount(tp, LOCATION_HAND, 0))
        end)
        c:RegisterEffect(e)
      end
      `;
      },
    };

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    applyAndAssert(session, end!);

    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")).toHaveLength(2);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["preDraw"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1113, eventPlayer: 1, eventValue: 1 });
    expect(session.state.pendingTriggers[0]).not.toHaveProperty("eventReason");
    expect(session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonPlayer");
    expect(session.state.eventHistory.slice(-5)).toEqual([
      expect.objectContaining({ eventName: "preDraw", eventCode: 1113, eventPlayer: 1, eventValue: 1 }),
      expect.objectContaining({ eventName: "phaseDraw", eventCode: 0x1001, eventPlayer: 1 }),
      expect.objectContaining({ eventName: "phaseStartMain1", eventCode: 0x2004 }),
      expect.objectContaining({ eventName: "turnStarted" }),
      expect.objectContaining({ eventName: "phaseMain1", eventCode: 0x1004 }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1113, eventPlayer: 1, eventValue: 1 });
    expect(restored.session.state.pendingTriggers[0]).not.toHaveProperty("eventReason");
    expect(restored.session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonPlayer");
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const restoredTrigger = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, restoredTrigger!, 1);
    applyLuaRestoreAndAssert(restored, restoredTrigger!);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("predraw resolved 1/1/1/0/1/2");

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    drainChain(session);
    expect(host.messages).toContain("predraw resolved 1/1/1/0/1/2");
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

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expectLuaRestoreStalePreapply(restored, pass!, player);
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, result, result.state.waitingFor!);
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
