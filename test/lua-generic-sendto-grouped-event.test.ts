import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua generic Sendto grouped events", () => {
  it("collects one grouped EVENT_TO_GRAVE success event for generic grave sends", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Generic Send Grave First", kind: "monster" },
      { code: "201", name: "Generic Send Grave Second", kind: "monster" },
      { code: "300", name: "Generic Send Grave Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 110, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_TO_GRAVE", "LOCATION_GRAVE", "generic grave")}
      Debug.Message("generic grave sent " .. Duel.Sendto(Group.FromCards(first, second), LOCATION_GRAVE, REASON_EFFECT))
      `,
      "generic-sendto-grave-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedMove(session, host, "generic grave sent 2", "graveyard", ["generic grave first group 2", "generic grave second group 2", "generic grave generic group 2"]);
  });

  it("collects one grouped EVENT_REMOVE success event for generic banish sends", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Generic Send Remove First", kind: "monster" },
      { code: "201", name: "Generic Send Remove Second", kind: "monster" },
      { code: "300", name: "Generic Send Remove Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 111, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_REMOVE", "LOCATION_REMOVED", "generic remove")}
      Debug.Message("generic remove sent " .. Duel.Sendto(Group.FromCards(first, second), LOCATION_REMOVED, REASON_EFFECT, POS_FACEUP))
      `,
      "generic-sendto-remove-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedMove(session, host, "generic remove sent 2", "banished", ["generic remove first group 2", "generic remove second group 2", "generic remove generic group 2"]);
  });

  it("collects one grouped EVENT_TO_DECK success event for MoveToDeckTop sends", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Deck Top Send First", kind: "monster" },
      { code: "201", name: "Deck Top Send Second", kind: "monster" },
      { code: "300", name: "Deck Top Send Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 112, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_TO_DECK", "LOCATION_DECK", "deck top")}
      Debug.Message("deck top sent " .. Duel.MoveToDeckTop(Group.FromCards(first, second), 0, REASON_EFFECT))
      `,
      "move-to-deck-top-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedMove(session, host, "deck top sent 2", "deck", ["deck top first group 2", "deck top second group 2", "deck top generic group 2"]);
  });

  it("collects one grouped EVENT_TO_DECK success event for MoveToDeckBottom sends", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Deck Bottom Send First", kind: "monster" },
      { code: "201", name: "Deck Bottom Send Second", kind: "monster" },
      { code: "300", name: "Deck Bottom Send Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 113, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_TO_DECK", "LOCATION_DECK", "deck bottom")}
      Debug.Message("deck bottom sent " .. Duel.MoveToDeckBottom(Group.FromCards(first, second), 0, REASON_EFFECT))
      `,
      "move-to-deck-bottom-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedMove(session, host, "deck bottom sent 2", "deck", ["deck bottom first group 2", "deck bottom second group 2", "deck bottom generic group 2"]);
  });

  it.each([
    { label: "top", api: "MoveToDeckTop", seed: 114 },
    { label: "bottom", api: "MoveToDeckBottom", seed: 115 },
  ])("preserves active Lua reason source metadata for MoveToDeck$label triggers", ({ api, seed }) => {
    const cards: DuelCardData[] = [
      { code: "100", name: `${api} Source`, kind: "monster" },
      { code: "200", name: `${api} Target`, kind: "monster" },
      { code: "300", name: `${api} Watcher`, kind: "monster" },
    ];
    const session = createDuel({ seed, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        source_effect=e
        Debug.Message("${api} reason count " .. Duel.${api}(target, tp, REASON_EFFECT))
        Debug.Message("${api} reason source " .. tostring(target:GetReasonCard()==starter) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
      end)
      starter:RegisterEffect(move)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_TO_DECK)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp,eg)
        local moved=eg:GetFirst()
        Debug.Message("${api} event reason source " .. tostring(moved:GetReasonCard():IsCode(100)) .. "/" .. tostring(moved:GetReasonEffect()==source_effect))
      end)
      watcher:RegisterEffect(trigger)
      `,
      `${api}-reason-source.lua`,
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(host.messages).toContain(`${api} reason count 1`);
    expect(host.messages).toContain(`${api} reason source true/true`);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToDeck", eventCode: 1013, eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain(`${api} event reason source true/true`);
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
        Debug.Message("${label} generic group " .. eg:GetCount())
      end)
      watcher:RegisterEffect(generic)
  `;
}

function assertGroupedMove(session: DuelSession, host: ReturnType<typeof createLuaScriptHost>, message: string, location: "graveyard" | "banished" | "deck", resolvedMessages: string[]): void {
  const first = session.state.cards.find((card) => card.code === "200");
  const second = session.state.cards.find((card) => card.code === "201");
  const watcher = session.state.cards.find((card) => card.code === "300");
  expect(host.messages).toContain(message);
  expect(first).toMatchObject({ location });
  expect(second).toMatchObject({ location });
  expect(session.state.pendingTriggers).toHaveLength(3);
  for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
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

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
