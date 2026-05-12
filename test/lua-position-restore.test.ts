import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua position restore helpers", () => {
  it("applies restored Lua position-change triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Position Starter", kind: "monster" },
      { code: "200", name: "Restore Position Target", kind: "monster" },
      { code: "300", name: "Restore Position Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_MZONE)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              Debug.Message("position changed " .. Duel.ChangePosition(target, POS_FACEUP_DEFENSE))
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
            e:SetCode(EVENT_CHANGE_POS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              local tc=eg:GetFirst()
              Debug.Message("restored position trigger " .. tc:GetCode() .. "/" .. tc:GetPosition())
              Debug.Message("restored position reason " .. tostring(r==REASON_EFFECT) .. "/" .. tostring(rp==0) .. "/" .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(100)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 67, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const code of ["100", "200"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const starterScript = host.loadCardScript(100, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(starterScript.ok, starterScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("position changed 1");
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["positionChanged"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1016, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["positionChanged"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1016, eventCardUid: target!.uid, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 0).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === trigger!.effectId))).toBe(true);
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["positionChanged"]);
    expect(restored.host.messages).not.toContain("restored position trigger 200/4");
    expect(restored.host.messages).not.toContain("restored position reason true/true/true");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored position trigger 200/4");
    expect(restored.host.messages).toContain("restored position reason true/true/true");
    const staleReplay = applyLuaRestoreResponse(restored, trigger!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });

  it("restores position-change missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Position Boundary Source", kind: "monster" },
      { code: "200", name: "Restore Position Boundary Target", kind: "monster" },
      { code: "300", name: "Restore When Position Watcher", kind: "monster" },
      { code: "400", name: "Restore If Position Watcher", kind: "monster" },
      { code: "500", name: "Restore Position Damage Watcher", kind: "monster" },
    ];
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              Duel.ChangePosition(target, POS_FACEUP_DEFENSE)
              Duel.Damage(1, 100, REASON_EFFECT)
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
            e:SetCode(EVENT_CHANGE_POS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when position resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_CHANGE_POS)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if position resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          c500={}
          function c500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 263, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1016");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1016", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "positionChanged", eventCode: 1016 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1016");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1016", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1016");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1016", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1016")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1016")).toBe(false);
  });
});

function getLuaRestoreTriggerEffectIds(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1): string[] {
  return getLuaRestoreLegalActions(restored, player).flatMap((action) => (action.type === "activateTrigger" ? [action.effectId] : []));
}

function hasGroupedTrigger(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
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
