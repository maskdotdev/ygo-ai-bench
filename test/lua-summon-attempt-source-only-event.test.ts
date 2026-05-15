import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelEventName, DuelSession } from "#duel/types.js";

describe("Lua source-only summon-attempt events", () => {
  it.each([
    { label: "normal", eventConstant: "EVENT_SUMMON", eventName: "normalSummoning" as DuelEventName, eventCode: 1103, range: "LOCATION_HAND" },
    { label: "flip", eventConstant: "EVENT_FLIP_SUMMON", eventName: "flipSummoning" as DuelEventName, eventCode: 1104, range: "LOCATION_MZONE" },
    { label: "special", eventConstant: "EVENT_SPSUMMON", eventName: "specialSummoning" as DuelEventName, eventCode: 1105, range: "LOCATION_HAND" },
  ])("binds $eventConstant single triggers only to the attempted summon source card", ({ label, eventConstant, eventName, eventCode, range }) => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Summon Attempt", kind: "monster" },
      { code: "300", name: "Summon Attempt Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Summon Attempt Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 127 + eventCode, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c100.lua") return `
      c100={}
      function c100.initial_effect(c)
      local source_trigger=Effect.CreateEffect(c)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(${eventConstant})
      source_trigger:SetRange(${range})
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source ${label} attempt " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(source_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local generic_trigger=Effect.CreateEffect(c)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(${eventConstant})
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic ${label} attempt " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(generic_trigger)
      end
      `;
        if (name === "c301.lua") return `
      c301={}
      function c301.initial_effect(c)
      local wrong_single=Effect.CreateEffect(c)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(${eventConstant})
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong ${label} attempt " .. eg:GetCount())
      end)
      c:RegisterEffect(wrong_single)
      end
      `;
        return undefined;
      },
    };
    for (const code of [100, 300, 301]) {
      const loaded = host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const source = session.state.cards.find((card) => card.code === "100");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(source).toBeDefined();

    performSummonAttempt(session, label, source!.uid);

    const attemptTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
    expect(attemptTriggers).toHaveLength(2);
    expect(attemptTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode }),
      ]),
    );
    expect(attemptTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const restoredAttemptTriggers = restored.session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
    expect(restoredAttemptTriggers).toHaveLength(2);
    expect(restoredAttemptTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode }),
      ]),
    );
    expect(restoredAttemptTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining([`source ${label} attempt 1/100`, `generic ${label} attempt 1/100`]));
    expect(restored.host.messages).not.toContain(`wrong ${label} attempt 1`);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining([`source ${label} attempt 1/100`, `generic ${label} attempt 1/100`]));
    expect(host.messages).not.toContain(`wrong ${label} attempt 1`);
  });
});

function performSummonAttempt(session: DuelSession, label: string, sourceUid: string): void {
  if (label === "normal") {
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === sourceUid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    return;
  }
  if (label === "flip") {
    const source = session.state.cards.find((card) => card.uid === sourceUid)!;
    moveDuelCard(session.state, sourceUid, "monsterZone", 0).position = "faceDownDefense";
    source.faceUp = false;
    const flip = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === sourceUid);
    expect(flip).toBeDefined();
    applyAndAssert(session, flip!);
    return;
  }
  specialSummonDuelCard(session.state, sourceUid, 0);
}

function activateAllTriggers(session: DuelSession): void {
  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
}

function activateAllRestoredTriggers(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (;;) {
    const player = restored.session.state.waitingFor ?? 0;
    const trigger = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyLuaRestoreAndAssert(restored, trigger);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
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
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(queryPublicState(restored.session)).toEqual(response.state);
  return response;
}
