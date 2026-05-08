import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only grouped move events", () => {
  it("binds EVENT_MOVE single triggers only to their moved source cards", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Moved First", kind: "monster" },
      { code: "201", name: "Moved Second", kind: "monster" },
      { code: "300", name: "Move Generic Watcher", kind: "monster" },
      { code: "301", name: "Unmoved Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 181, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300", "301"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_MOVE)
      first_trigger:SetRange(LOCATION_HAND)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("first single move " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_MOVE)
      second_trigger:SetRange(LOCATION_HAND)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("second single move " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      second:RegisterEffect(second_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_MOVE)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic move " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_MOVE)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong single move " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("sent " .. Duel.SendtoHand(Group.FromCards(first, second), 0, REASON_EFFECT))
      `,
      "move-source-only-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(host.messages).toContain("sent 2");
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "moved")).toHaveLength(3);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid, eventUids: [first!.uid, second!.uid] }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid, eventUids: [first!.uid, second!.uid] }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: first!.uid, eventUids: [first!.uid, second!.uid] }),
      ]),
    );
    expect(session.state.pendingTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["first single move 2/200", "second single move 2/200", "generic move 2/2"]));
    expect(host.messages).not.toContain("wrong single move 2");
  });

  it("binds EVENT_LEAVE_GRAVE single triggers only to their source card", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Leaving Grave", kind: "monster" },
      { code: "300", name: "Leave Grave Generic Watcher", kind: "monster" },
      { code: "301", name: "Unmoved Leave Grave Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 182, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "300", "301"] }, 1: { main: [] } });
    startDuel(session);
    const leaving = session.state.cards.find((candidate) => candidate.code === "200");
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, leaving!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local leaving=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(leaving)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_LEAVE_GRAVE)
      source_trigger:SetRange(LOCATION_HAND)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source leave grave " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      leaving:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_LEAVE_GRAVE)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic leave grave " .. eg:GetCount())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_LEAVE_GRAVE)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong leave grave " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("sent " .. Duel.SendtoHand(leaving, 0, REASON_EFFECT))
      `,
      "leave-grave-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(host.messages).toContain("sent 1");
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "leftGraveyard")).toHaveLength(2);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: leaving!.uid, eventCardUid: leaving!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: leaving!.uid }),
      ]),
    );
    expect(session.state.pendingTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["source leave grave 1/200", "generic leave grave 1"]));
    expect(host.messages).not.toContain("wrong leave grave 1");
  });
});

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
