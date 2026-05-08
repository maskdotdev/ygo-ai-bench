import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only grouped leave-field events", () => {
  it("groups EVENT_LEAVE_FIELD and binds single triggers only to their leaving source cards", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Leave Field First", kind: "monster" },
      { code: "201", name: "Leave Field Second", kind: "monster" },
      { code: "300", name: "Leave Field Generic Watcher", kind: "monster" },
      { code: "301", name: "Unmoved Leave Field Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 184, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300", "301"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0).position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_LEAVE_FIELD)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("first leave field " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_LEAVE_FIELD)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("second leave field " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_LEAVE_FIELD)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic leave field " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_LEAVE_FIELD)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong leave field " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("sent " .. Duel.SendtoGrave(Group.FromCards(first, second), REASON_EFFECT))
      `,
      "leave-field-source-only-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(host.messages).toContain("sent 2");
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "leftField")).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers.filter((candidate) => candidate.eventName === "leftField")) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    expect(session.state.pendingTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["first leave field 2/2", "second leave field 2/2", "generic leave field 2/2"]));
    expect(host.messages).not.toContain("wrong leave field 2");
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
