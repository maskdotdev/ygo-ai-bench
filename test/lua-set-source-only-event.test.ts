import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelEventName, DuelSession } from "#duel/types.js";

describe("Lua source-only Set events", () => {
  it.each([
    { label: "monster", sourceKind: "monster" as const, eventConstant: "EVENT_MSET", eventName: "monsterSet" as DuelEventName, eventCode: 1106, range: "LOCATION_MZONE", actionType: "setMonster" },
    { label: "spell", sourceKind: "spell" as const, eventConstant: "EVENT_SSET", eventName: "spellTrapSet" as DuelEventName, eventCode: 1107, range: "LOCATION_SZONE", actionType: "setSpellTrap" },
  ])("binds $eventConstant single triggers only to the Set source card", ({ label, sourceKind, eventConstant, eventName, eventCode, range, actionType }) => {
    const sourceCard: DuelCardData = sourceKind === "monster" ? { code: "100", name: "Source-Only Set Monster", kind: "monster" } : { code: "100", name: "Source-Only Set Spell", kind: "spell", typeFlags: 0x2 };
    const cards: DuelCardData[] = [
      sourceCard,
      { code: "300", name: "Set Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Set Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 126 + eventCode, startingHandSize: 3, cardReader: createCardReader(cards) });
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
        Debug.Message("source ${label} set " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      source:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(${eventConstant})
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic ${label} set " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(${eventConstant})
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong ${label} set " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      `${label}-set-source-only-event.lua`,
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const source = session.state.cards.find((card) => card.code === "100");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(source).toBeDefined();

    const action =
      actionType === "setMonster"
        ? getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === source!.uid)
        : getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const setTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
    expect(setTriggers).toHaveLength(2);
    expect(setTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: source!.uid, eventCardUid: source!.uid, eventCode }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: source!.uid, eventCode }),
      ]),
    );
    expect(setTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining([`source ${label} set 1/100`, `generic ${label} set 1/100`]));
    expect(host.messages).not.toContain(`wrong ${label} set 1`);
  });
});

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
