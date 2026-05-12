import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua move events", () => {
  it("queues Lua generic move triggers after cards move", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Move Starter", kind: "monster" },
      { code: "200", name: "Move Target", kind: "monster" },
      { code: "300", name: "Move Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Debug.Message("move event count " .. Duel.SendtoHand(target, 1, REASON_EFFECT))
      end)
      starter:RegisterEffect(move)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_MOVE)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("move trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "generic-move-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("move event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand", controller: 1 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["moved"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1030, eventCardUid: target!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("move trigger resolved 200");
  });

  it("applies restored Lua generic move triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Move Starter", kind: "monster" },
      { code: "200", name: "Restore Move Target", kind: "monster" },
      { code: "300", name: "Restore Move Watcher", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil)
              Duel.SendtoHand(target, 1, REASON_EFFECT)
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
            e:SetCode(EVENT_MOVE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg)
              Debug.Message("restored move trigger " .. eg:GetFirst():GetCode())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 179, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["moved"]);
    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["moved"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1030, eventCardUid: target!.uid });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertPublicRestoreMetadata(restored, staleTrigger);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["moved"]);
    expect(restored.host.messages).not.toContain("restored move trigger 200");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored move trigger 200");
  });

  it.each([
    { label: "hand", api: "SendtoHand", event: "EVENT_TO_HAND", eventName: "sentToHand", eventCode: 1012 },
    { label: "deck", api: "SendtoDeck", event: "EVENT_TO_DECK", eventName: "sentToDeck", eventCode: 1013 },
  ])("preserves Duel.$api active reason source for sent-to-$label events", ({ api, event, eventName, eventCode }) => {
    const cards: DuelCardData[] = [
      { code: "100", name: `${api} Starter`, kind: "monster" },
      { code: "200", name: `${api} Target`, kind: "monster" },
      { code: "300", name: `${api} Watcher`, kind: "monster" },
    ];
    const session = createDuel({ seed: 1178 + eventCode, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source_effect=nil
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        source_effect=e
        Duel.${api}(target, tp, REASON_EFFECT)
        Debug.Message("${eventName} reason source " .. tostring(target:GetReasonCard()==starter) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
      end)
      starter:RegisterEffect(move)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(${event})
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp,eg)
        local moved=eg:GetFirst()
        Debug.Message("${eventName} event reason source " .. tostring(moved:GetReasonCard():IsCode(100)) .. "/" .. tostring(moved:GetReasonEffect()==source_effect))
      end)
      watcher:RegisterEffect(trigger)
      `,
      `${eventName}-reason-source.lua`,
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain(`${eventName} reason source true/true`);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual([eventName]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode, eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain(`${eventName} event reason source true/true`);
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
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertPublicRestoreMetadata(restored: Parameters<typeof applyLuaRestoreResponse>[0], response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
