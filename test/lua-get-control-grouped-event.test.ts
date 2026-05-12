import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua GetControl grouped events", () => {
  it("preserves active Lua reason source metadata for controlled cards and grouped control events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Control Reason Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Control Reason Target", kind: "monster", typeFlags: 0x21 },
      { code: "201", name: "Control Reason Second Target", kind: "monster", typeFlags: 0x21 },
      { code: "700", name: "Control Reason Watcher", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "700"] }, 1: { main: ["200", "201"] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    expect(source).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    for (const card of [first!, second!]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
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
          local first=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
          local second=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 201), tp, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
          Debug.Message("control reason result " .. Duel.GetControl(Group.FromCards(first, second), tp, 0, 0, LOCATION_MZONE))
          Debug.Message("control reason first " .. tostring(first:GetReasonCard()==c) .. "/" .. tostring(first:GetReasonEffect()==source_effect))
          Debug.Message("control reason second " .. tostring(second:GetReasonCard()==c) .. "/" .. tostring(second:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c700={}
      function c700.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CONTROL_CHANGED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local changed=eg:GetFirst()
          Debug.Message("control event reason source " .. tostring(changed:GetReasonCard():IsCode(100)) .. "/" .. tostring(changed:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "get-control-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(expect.arrayContaining(["control reason result 2", "control reason first true/true", "control reason second true/true"]));
    expect(first).toMatchObject({ controller: 0, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(second).toMatchObject({ controller: 0, reasonCardUid: source!.uid, reasonEffectId: 1 });
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "controlChanged", eventCardUid: first!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("control event reason source true/true");
  });

  it("collects one grouped EVENT_CONTROL_CHANGED event for direct group control changes", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Grouped Control First", kind: "monster" },
      { code: "201", name: "Grouped Control Second", kind: "monster" },
      { code: "300", name: "Grouped Control Watcher", kind: "monster" },
      { code: "301", name: "Grouped Control Filler", kind: "monster" },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["300", "301"] }, 1: { main: ["200", "201"] } });
    startDuel(session);
    for (const code of ["200", "201"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 1);
      card!.position = "faceUpAttack";
      card!.faceUp = true;
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_CONTROL_CHANGED)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("control first group " .. eg:GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_CONTROL_CHANGED)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("control second group " .. eg:GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_CONTROL_CHANGED)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("control generic group " .. eg:GetCount())
      end)
      watcher:RegisterEffect(generic)

      Debug.Message("control grouped " .. Duel.GetControl(Group.FromCards(first, second), 0, 0, 0, LOCATION_MZONE))
      `,
      "get-control-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(host.messages).toContain("control grouped 2");
    expect(first).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(second).toMatchObject({ controller: 0, location: "monsterZone" });
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
    expect(host.messages).toEqual(expect.arrayContaining(["control first group 2", "control second group 2", "control generic group 2"]));
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
