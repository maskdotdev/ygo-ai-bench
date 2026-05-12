import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua ChangePosition grouped events", () => {
  it("preserves active Lua reason source metadata for position-change events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Position Reason Source", kind: "monster" },
      { code: "200", name: "Position Reason Target", kind: "monster" },
      { code: "201", name: "Position Reason Second Target", kind: "monster" },
      { code: "300", name: "Position Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 287, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(second).toBeDefined();
    expect(watcher).toBeDefined();
    for (const card of [target!, second!]) {
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
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          Duel.ChangePosition(Group.FromCards(target, second), POS_FACEUP_DEFENSE)
          Debug.Message("position reason source " .. tostring(target:GetReasonCard()==c) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHANGE_POS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local changed=eg:GetFirst()
          Debug.Message("position event reason source " .. eg:GetCount() .. "/" .. tostring(changed:GetReasonCard():IsCode(100)) .. "/" .. tostring(changed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "change-position-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("position reason source true/true");
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "positionChanged", eventCardUid: target!.uid, eventUids: [target!.uid, second!.uid], eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("position event reason source 2/true/true");
  });

  it("collects one grouped EVENT_CHANGE_POS success event for direct group position changes", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Position First", kind: "monster" },
      { code: "201", name: "Grouped Position Second", kind: "monster" },
      { code: "300", name: "Grouped Position Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 105, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "201", "300"] }, 1: { main: [] } });
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

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_CHANGE_POS)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("position first group " .. eg:GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_CHANGE_POS)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("position second group " .. eg:GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_CHANGE_POS)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("position generic group " .. eg:GetCount())
      end)
      watcher:RegisterEffect(generic)

      Debug.Message("position grouped " .. Duel.ChangePosition(Group.FromCards(first, second), POS_FACEUP_DEFENSE))
      `,
      "change-position-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(host.messages).toContain("position grouped 2");
    expect(first).toMatchObject({ location: "monsterZone", position: "faceUpDefense" });
    expect(second).toMatchObject({ location: "monsterZone", position: "faceUpDefense" });
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
      const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(session, trigger);
    }
    expect(host.messages).toEqual(expect.arrayContaining(["position first group 2", "position second group 2", "position generic group 2"]));
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
