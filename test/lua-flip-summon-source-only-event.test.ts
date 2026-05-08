import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, flipSummonDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only Flip Summon events", () => {
  it("binds EVENT_FLIP and EVENT_FLIP_SUMMON_SUCCESS single triggers only to the flipped source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Flip Monster", kind: "monster" },
      { code: "300", name: "Flip Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Flip Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 3, cardReader: createCardReader(cards) });
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
      source_trigger:SetCode(EVENT_FLIP)
      source_trigger:SetRange(LOCATION_MZONE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source flip alias " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      source:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic flip success " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong flip success " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "flip-summon-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const source = session.state.cards.find((card) => card.code === "100");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(source).toBeDefined();

    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceDownDefense";
    source!.faceUp = false;
    flipSummonDuelCard(session.state, 0, source!.uid);

    const flipTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "flipSummoned");
    expect(flipTriggers).toHaveLength(2);
    expect(flipTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode: 1101 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode: 1101 }),
      ]),
    );
    expect(flipTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["source flip alias 1/100", "generic flip success 1/100"]));
    expect(host.messages).not.toContain("wrong flip success 1");
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
