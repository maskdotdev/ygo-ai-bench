import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, flipSummonDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua Flip Summon restore helpers", () => {
  it("applies restored Lua EVENT_FLIP alias triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Flip Alias Source", kind: "monster" },
      { code: "300", name: "Restore Flip Alias Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_FLIP)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            local tc=eg:GetFirst()
            Debug.Message("restored flip alias " .. tc:GetCode() .. "/" .. tostring(tc:IsFlipSummoned()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 66, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: [] } });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.code === "100");
    expect(monster).toBeDefined();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    monster!.faceUp = false;

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(300, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    flipSummonDuelCard(session.state, 0, monster!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1001, eventCardUid: monster!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1001, eventCardUid: monster!.uid });
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
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["flipSummoned"]);
    expect(restored.host.messages).not.toContain("restored flip alias 100/true");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored flip alias 100/true");
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
    expect(host.messages).toContain("restored flip alias 100/true");
  });

  it("applies restored Lua flip-summon success triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Flip Source", kind: "monster" },
      { code: "300", name: "Restore Flip Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            local tc=eg:GetFirst()
            Debug.Message("restored flip summon success " .. tc:GetCode() .. "/" .. tostring(tc:IsFlipSummoned()) .. "/" .. tc:GetSummonType())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 65, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: [] } });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.code === "100");
    expect(monster).toBeDefined();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    monster!.faceUp = false;

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(300, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    flipSummonDuelCard(session.state, 0, monster!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });
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
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["flipSummoned"]);
    expect(restored.host.messages).not.toContain("restored flip summon success 100/true/536870912");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored flip summon success 100/true/536870912");
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
    expect(host.messages).toContain("restored flip summon success 100/true/536870912");
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function hasGroupedTrigger(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
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
