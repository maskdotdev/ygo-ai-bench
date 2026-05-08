import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
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
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(source)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(${eventConstant})
      source_trigger:SetRange(${range})
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source ${label} attempt " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      source:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(${eventConstant})
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic ${label} attempt " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(${eventConstant})
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong ${label} attempt " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      `${label}-summon-attempt-source-only-event.lua`,
    );
    expect(loaded.ok, loaded.error).toBe(true);

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

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
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

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
