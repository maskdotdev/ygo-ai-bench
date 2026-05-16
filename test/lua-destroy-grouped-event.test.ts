import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua Destroy grouped events", () => {
  it("preserves active Lua reason source metadata for grouped destruction events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Destroy Reason Source", kind: "monster" },
      { code: "200", name: "Destroy Reason First", kind: "monster" },
      { code: "201", name: "Destroy Reason Second", kind: "monster" },
      { code: "300", name: "Destroy Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 288, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(watcher).toBeDefined();
    for (const card of [first!, second!]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.position = "faceUpAttack";
      card.faceUp = true;
    }

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
          local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          Duel.Destroy(Group.FromCards(first, second), REASON_EFFECT)
          Debug.Message("destroy reason source " .. tostring(first:GetReasonCard()==c) .. "/" .. tostring(first:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_TRIGGER_O)
        e1:SetCode(EVENT_DESTROY)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg)
          local destroyed=eg:GetFirst()
          Debug.Message("destroying event reason source " .. eg:GetCount() .. "/" .. tostring(destroyed:GetReasonCard():IsCode(100)) .. "/" .. tostring(destroyed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_TRIGGER_O)
        e2:SetCode(EVENT_DESTROYED)
        e2:SetRange(LOCATION_HAND)
        e2:SetOperation(function(e,tp,eg)
          local destroyed=eg:GetFirst()
          Debug.Message("destroyed event reason source " .. eg:GetCount() .. "/" .. tostring(destroyed:GetReasonCard():IsCode(100)) .. "/" .. tostring(destroyed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e2)
      end
      `,
      "destroy-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("destroy reason source true/true");
    for (const eventName of ["destroying", "destroyed"]) {
      expect(session.state.pendingTriggers).toContainEqual(
        expect.objectContaining({ eventName, eventCardUid: first!.uid, eventUids: [first!.uid, second!.uid], eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
      );
    }
    for (;;) {
      const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(
      expect.arrayContaining(["destroying event reason source 2/true/true", "destroyed event reason source 2/true/true"]),
    );
  });

  it("collects one grouped EVENT_DESTROY pre-event for direct group destruction", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Destroying First", kind: "monster" },
      { code: "201", name: "Grouped Destroying Second", kind: "monster" },
      { code: "300", name: "Grouped Destroying Watcher", kind: "monster" },
      { code: "301", name: "Unmoved Destroying Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 104, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300", "301"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
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
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DESTROY)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("destroying first group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DESTROY)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("destroying second group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_DESTROY)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("destroying generic group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      watcher:RegisterEffect(generic)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_DESTROY)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("destroying wrong single " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("destroy grouped " .. Duel.Destroy(Group.FromCards(first, second), REASON_EFFECT))
      `,
      "destroying-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(host.messages).toContain("destroy grouped 2");
    const destroyingTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "destroying");
    expect(destroyingTriggers).toHaveLength(3);
    for (const trigger of destroyingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(destroyingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    expect(destroyingTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["destroying first group 2/2", "destroying second group 2/2", "destroying generic group 2/2"]));
    expect(host.messages).not.toContain("destroying wrong single 2");
  });

  it("collects one grouped EVENT_DESTROYED success event for direct group destruction", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Destroy First", kind: "monster" },
      { code: "201", name: "Grouped Destroy Second", kind: "monster" },
      { code: "300", name: "Grouped Destroy Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 103, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c200.lua") return `
      c200={}
      function c200.initial_effect(c)
      local first_trigger=Effect.CreateEffect(c)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DESTROYED)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("destroy first group " .. eg:GetCount())
      end)
      c:RegisterEffect(first_trigger)
      end
      `;
        if (name === "c201.lua") return `
      c201={}
      function c201.initial_effect(c)
      local second_trigger=Effect.CreateEffect(c)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DESTROYED)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("destroy second group " .. eg:GetCount())
      end)
      c:RegisterEffect(second_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local destroy=Effect.CreateEffect(c)
      destroy:SetType(EFFECT_TYPE_IGNITION)
      destroy:SetRange(LOCATION_HAND)
      destroy:SetOperation(function(e,tp)
        local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
        local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
        Debug.Message("destroy grouped " .. Duel.Destroy(Group.FromCards(first, second), REASON_EFFECT))
      end)
      c:RegisterEffect(destroy)

      local generic=Effect.CreateEffect(c)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_DESTROYED)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("destroy generic group " .. eg:GetCount())
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

    const watcher = session.state.cards.find((card) => card.code === "300");
    const destroyAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === watcher!.uid);
    expect(destroyAction).toBeDefined();
    applyAndAssert(session, destroyAction!);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    expect(host.messages).toContain("destroy grouped 2");
    expect(first).toMatchObject({ location: "graveyard" });
    expect(second).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: watcher!.uid, eventCardUid: first!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
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
    expect(restored.host.messages).toEqual(expect.arrayContaining(["destroy first group 2", "destroy second group 2", "destroy generic group 2"]));

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["destroy first group 2", "destroy second group 2", "destroy generic group 2"]));
  });
});

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
