import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua draw grouped events", () => {
  it("collects one grouped EVENT_DRAW success event for multi-card draws", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Drawn First", kind: "monster" },
      { code: "201", name: "Drawn Second", kind: "monster" },
      { code: "300", name: "Draw Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);
    const expectedDrawnUids = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, 2)
      .map((card) => card.uid);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local targets=Duel.GetDecktopGroup(0, 2)
      local first=targets:GetFirst()
      local second=targets:GetNext()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DRAW)
      first_trigger:SetRange(LOCATION_HAND)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("draw first group " .. eg:GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DRAW)
      second_trigger:SetRange(LOCATION_HAND)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("draw second group " .. eg:GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_DRAW)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("draw generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(generic)

      Debug.Message("draw grouped " .. Duel.Draw(0, 2, REASON_EFFECT))
      `,
      "draw-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.uid === expectedDrawnUids[0]);
    const second = session.state.cards.find((card) => card.uid === expectedDrawnUids[1]);
    expect(host.messages).toContain("draw grouped 2");
    expect(first).toMatchObject({ location: "hand" });
    expect(second).toMatchObject({ location: "hand" });
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual(expectedDrawnUids);
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
    expect(host.messages).toEqual(expect.arrayContaining(["draw first group 2", "draw second group 2", "draw generic group 2/2"]));
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
