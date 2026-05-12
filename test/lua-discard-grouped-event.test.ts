import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelLocation, DuelSession } from "#duel/types.js";

describe("Lua discard grouped events", () => {
  it("collects one grouped EVENT_DISCARD success event for deck discards", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Deck Discard First", kind: "monster" },
      { code: "201", name: "Deck Discard Second", kind: "monster" },
      { code: "300", name: "Deck Discard Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 121, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local first_trigger=Effect.CreateEffect(c)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DISCARD)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("deck discard first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DISCARD)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("deck discard second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local discard=Effect.CreateEffect(c)
      discard:SetType(EFFECT_TYPE_IGNITION)
      discard:SetRange(LOCATION_HAND)
      discard:SetOperation(function(e,tp)
        Debug.Message("deck discarded " .. Duel.DiscardDeck(tp, 2, REASON_EFFECT+REASON_DISCARD))
      end)
      c:RegisterEffect(discard)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_DISCARD)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("deck discard generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      c:RegisterEffect(generic)
      end
      `;
        return undefined;
      },
    };
    for (const code of [200, 201, 300]) {
      const loaded = host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const discardAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(discardAction).toBeDefined();
    applyAndAssert(session, discardAction!);

    assertGroupedDiscard(session, host, "deck discarded 2", "graveyard", ["deck discard first group 2", "deck discard second group 2", "deck discard generic group 2/2"], { sourceScripts, cards });
  });

  it("collects one grouped EVENT_TO_GRAVE success event for hand discards", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Hand Discard First", kind: "monster" },
      { code: "201", name: "Hand Discard Second", kind: "monster" },
      { code: "300", name: "Hand Discard Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      ${registerGroupedTrigger("EVENT_TO_GRAVE", "LOCATION_GRAVE", "hand discard")}
      Debug.Message("hand discarded " .. Duel.DiscardHand(0, function(c) return c:IsCode(200) or c:IsCode(201) end, 2, 2, REASON_EFFECT+REASON_DISCARD))
      `,
      "discard-hand-to-grave-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedDiscard(session, host, "hand discarded 2", "graveyard", ["hand discard first group 2", "hand discard second group 2", "hand discard generic group 2/2"]);
  });

  it("preserves active Lua reason source metadata for deck discard triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Discard Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Discarded Deck Target", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 123, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    target!.sequence = 0;

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
          Debug.Message("reason deck discarded " .. Duel.DiscardDeck(tp, 1, REASON_EFFECT+REASON_DISCARD))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_DISCARD)
        e:SetRange(LOCATION_GRAVE)
        e:SetOperation(function(e,tp,eg)
          local c=e:GetHandler()
          local rc=c:GetReasonCard()
          local re=c:GetReasonEffect()
          Debug.Message("discard reason source " .. tostring(rc and rc:IsCode(100)) .. "/" .. tostring(re==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "discard-deck-reason-source-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("reason deck discarded 1");
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "discarded", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("discard reason source true/true");
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

function assertGroupedDiscard(
  session: DuelSession,
  host: ReturnType<typeof createLuaScriptHost>,
  message: string,
  location: DuelLocation,
  resolvedMessages: string[],
  restore?: { sourceScripts: { readScript(name: string): string | undefined }; cards: DuelCardData[] },
): void {
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

  if (restore) {
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), restore.sourceScripts, createCardReader(restore.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of restored.session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(restored.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(resolvedMessages));
  }

  activateAllTriggers(session);
  expect(host.messages).toEqual(expect.arrayContaining(resolvedMessages));
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

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
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
