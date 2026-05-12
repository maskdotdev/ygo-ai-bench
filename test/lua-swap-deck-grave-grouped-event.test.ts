import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua deck and graveyard swap grouped events", () => {
  it("collects grouped success events for deck cards sent to grave and grave cards sent to deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Deck First", kind: "monster" },
      { code: "101", name: "Swap Deck Second", kind: "monster" },
      { code: "200", name: "Swap Grave First", kind: "monster" },
      { code: "201", name: "Swap Grave Second", kind: "monster" },
      { code: "300", name: "Swap Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "101", "200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "graveyard", 0);
    }
    const watcher = session.state.cards.find((candidate) => candidate.code === "300");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local deck_targets=Duel.GetDecktopGroup(0, 2)
      local deck_first=deck_targets:GetFirst()
      local deck_second=deck_targets:GetNext()
      local grave_first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local grave_second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local deck_first_trigger=Effect.CreateEffect(deck_first)
      deck_first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      deck_first_trigger:SetCode(EVENT_TO_GRAVE)
      deck_first_trigger:SetRange(LOCATION_GRAVE)
      deck_first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("to grave first group " .. eg:GetCount())
      end)
      deck_first:RegisterEffect(deck_first_trigger)

      local deck_second_trigger=Effect.CreateEffect(deck_second)
      deck_second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      deck_second_trigger:SetCode(EVENT_TO_GRAVE)
      deck_second_trigger:SetRange(LOCATION_GRAVE)
      deck_second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("to grave second group " .. eg:GetCount())
      end)
      deck_second:RegisterEffect(deck_second_trigger)

      local to_grave_generic=Effect.CreateEffect(watcher)
      to_grave_generic:SetType(EFFECT_TYPE_TRIGGER_O)
      to_grave_generic:SetCode(EVENT_TO_GRAVE)
      to_grave_generic:SetRange(LOCATION_HAND)
      to_grave_generic:SetOperation(function(e,tp,eg)
        Debug.Message("to grave generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(to_grave_generic)

      local grave_first_trigger=Effect.CreateEffect(grave_first)
      grave_first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      grave_first_trigger:SetCode(EVENT_TO_DECK)
      grave_first_trigger:SetRange(LOCATION_DECK)
      grave_first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("to deck first group " .. eg:GetCount())
      end)
      grave_first:RegisterEffect(grave_first_trigger)

      local grave_second_trigger=Effect.CreateEffect(grave_second)
      grave_second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      grave_second_trigger:SetCode(EVENT_TO_DECK)
      grave_second_trigger:SetRange(LOCATION_DECK)
      grave_second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("to deck second group " .. eg:GetCount())
      end)
      grave_second:RegisterEffect(grave_second_trigger)

      local to_deck_generic=Effect.CreateEffect(watcher)
      to_deck_generic:SetType(EFFECT_TYPE_TRIGGER_O)
      to_deck_generic:SetCode(EVENT_TO_DECK)
      to_deck_generic:SetRange(LOCATION_HAND)
      to_deck_generic:SetOperation(function(e,tp,eg)
        Debug.Message("to deck generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(to_deck_generic)

      local move_generic=Effect.CreateEffect(watcher)
      move_generic:SetType(EFFECT_TYPE_TRIGGER_O)
      move_generic:SetCode(EVENT_MOVE)
      move_generic:SetRange(LOCATION_HAND)
      move_generic:SetOperation(function(e,tp,eg)
        Debug.Message("move generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(move_generic)

      local leave_grave_generic=Effect.CreateEffect(watcher)
      leave_grave_generic:SetType(EFFECT_TYPE_TRIGGER_O)
      leave_grave_generic:SetCode(EVENT_LEAVE_GRAVE)
      leave_grave_generic:SetRange(LOCATION_HAND)
      leave_grave_generic:SetOperation(function(e,tp,eg)
        Debug.Message("leave grave generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(leave_grave_generic)

      Duel.SwapDeckAndGrave(0)
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-deck-grave-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const toGrave = ["100", "101"].map((code) => session.state.cards.find((card) => card.code === code)!);
    const toDeck = ["200", "201"].map((code) => session.state.cards.find((card) => card.code === code)!);
    expect(host.messages).toContain("swap operated 4");
    expect(toGrave.every((card) => card.location === "graveyard")).toBe(true);
    expect(toDeck.every((card) => card.location === "deck")).toBe(true);
    expect(session.state.pendingTriggers).toHaveLength(8);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "moved")).toHaveLength(1);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "leftGraveyard")).toHaveLength(1);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "sentToGraveyard")).toHaveLength(3);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.eventName === "sentToDeck")).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers.filter((candidate) => candidate.eventName === "moved")) expect(trigger.eventUids).toEqual([...toGrave, ...toDeck].map((card) => card.uid));
    for (const trigger of session.state.pendingTriggers.filter((candidate) => candidate.eventName === "leftGraveyard")) expect(trigger.eventUids).toEqual(toDeck.map((card) => card.uid));
    for (const trigger of session.state.pendingTriggers.filter((candidate) => candidate.eventName === "sentToGraveyard")) expect(trigger.eventUids).toEqual(toGrave.map((card) => card.uid));
    for (const trigger of session.state.pendingTriggers.filter((candidate) => candidate.eventName === "sentToDeck")) expect(trigger.eventUids).toEqual(toDeck.map((card) => card.uid));

    for (;;) {
      const player = session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(
      expect.arrayContaining([
        "to grave first group 2",
        "to grave second group 2",
        "to grave generic group 2/2",
        "to deck first group 2",
        "to deck second group 2",
        "to deck generic group 2/2",
        "move generic group 4/4",
        "leave grave generic group 2/2",
      ]),
    );
  });

  it("preserves active Lua reason source metadata for swapped deck-to-grave triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Swap Deck Target", kind: "monster", typeFlags: 0x21 },
      { code: "300", name: "Swap Grave Target", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 179, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const deckTarget = session.state.cards.find((card) => card.code === "200");
    const graveTarget = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(deckTarget).toBeDefined();
    expect(graveTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, graveTarget!.uid, "graveyard", 0);
    deckTarget!.sequence = 0;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Duel.SwapDeckAndGrave(tp)
          Debug.Message("swap reason operated " .. Duel.GetOperatedGroup():GetCount())
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_GRAVE)
        e:SetOperation(function(e,tp,eg)
          local handler=e:GetHandler()
          local rc=handler:GetReasonCard()
          local re=handler:GetReasonEffect()
          Debug.Message("swap reason source " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(re==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "swap-deck-grave-reason-source-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("swap reason operated 2");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: deckTarget!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("swap reason source true/true");
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
