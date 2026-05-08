import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelLocation, DuelSession } from "#duel/types.js";

describe("Lua confirm grouped events", () => {
  it("collects one grouped EVENT_CONFIRM event for revealed deck groups", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Confirmed First", kind: "monster" },
      { code: "201", name: "Confirmed Second", kind: "monster" },
      { code: "300", name: "Confirm Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 124, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    moveWatcherToHand(session);
    const expectedUids = topDeckUids(session, 2);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local targets=Duel.GetDecktopGroup(0, 2)
      local first=targets:GetFirst()
      local second=targets:GetNext()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_CONFIRM", "LOCATION_DECK", "confirm")}
      Duel.ConfirmCards(1, targets)
      Debug.Message("confirm grouped requested")
      `,
      "confirm-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedConfirm(session, host, expectedUids, "deck", "confirm grouped requested", ["confirm first group 2", "confirm second group 2", "confirm generic group 2/2"]);
  });

  it("collects one grouped EVENT_TOHAND_CONFIRM event for revealed hand groups", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "To Hand Confirmed First", kind: "monster" },
      { code: "201", name: "To Hand Confirmed Second", kind: "monster" },
      { code: "300", name: "To Hand Confirm Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 125, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    moveWatcherToHand(session);
    const expectedUids = topDeckUids(session, 2);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local targets=Duel.GetDecktopGroup(0, 2)
      local first=targets:GetFirst()
      local second=targets:GetNext()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_TOHAND_CONFIRM", "LOCATION_HAND", "tohand confirm")}
      Duel.SendtoHand(targets, 0, REASON_EFFECT)
      Duel.ConfirmCards(1, targets)
      Debug.Message("tohand confirm grouped requested")
      `,
      "tohand-confirm-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedConfirm(session, host, expectedUids, "hand", "tohand confirm grouped requested", ["tohand confirm first group 2", "tohand confirm second group 2", "tohand confirm generic group 2/2"]);
  });
});

function registerGroupedTrigger(eventCode: string, sourceRange: string, label: string): string {
  return `
      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(${eventCode})
      first_trigger:SetRange(${sourceRange})
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("${label} first group " .. eg:GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(${eventCode})
      second_trigger:SetRange(${sourceRange})
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("${label} second group " .. eg:GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(${eventCode})
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("${label} generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(generic)
  `;
}

function assertGroupedConfirm(session: DuelSession, host: ReturnType<typeof createLuaScriptHost>, expectedUids: string[], location: DuelLocation, message: string, resolvedMessages: string[]): void {
  const first = session.state.cards.find((card) => card.uid === expectedUids[0]);
  const second = session.state.cards.find((card) => card.uid === expectedUids[1]);
  const watcher = session.state.cards.find((card) => card.code === "300");
  expect(host.messages).toContain(message);
  expect(first).toMatchObject({ location });
  expect(second).toMatchObject({ location });
  expect(session.state.pendingTriggers).toHaveLength(3);
  for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedUids);
  expect(session.state.pendingTriggers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
      expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
      expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
    ]),
  );

  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
  expect(host.messages).toEqual(expect.arrayContaining(resolvedMessages));
}

function moveWatcherToHand(session: DuelSession): void {
  const watcher = session.state.cards.find((card) => card.code === "300");
  expect(watcher).toBeDefined();
  moveDuelCard(session.state, watcher!.uid, "hand", 0);
}

function topDeckUids(session: DuelSession, count: number): string[] {
  return session.state.cards
    .filter((card) => card.controller === 0 && card.location === "deck")
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, count)
    .map((card) => card.uid);
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
