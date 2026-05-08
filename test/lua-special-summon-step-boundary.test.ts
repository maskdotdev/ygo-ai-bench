import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua SpecialSummonStep timing", () => {
  it("defers success triggers until SpecialSummonComplete", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deferred Step Source", kind: "monster" },
      { code: "200", name: "Deferred Step Target", kind: "monster" },
      { code: "300", name: "Deferred Step Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Debug.Message("deferred step " .. tostring(Duel.SpecialSummonStep(target, 0, 0, 0, false, false, POS_FACEUP_ATTACK)))
      end)
      source:RegisterEffect(e)

      local trigger=Effect.CreateEffect(watcher)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      trigger:SetCode(EVENT_SPSUMMON_SUCCESS)
      trigger:SetRange(LOCATION_HAND)
      trigger:SetOperation(function(e,tp)
        Debug.Message("deferred step trigger resolved")
      end)
      watcher:RegisterEffect(trigger)
      `,
      "special-summon-step-defers-success.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const summoned = session.state.cards.find((card) => card.code === "200");
    expect(summoned).toMatchObject({ location: "monsterZone", summonType: "special" });
    expect(host.messages).toContain("deferred step true");
    expect(session.state.pendingTriggers).not.toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: summoned!.uid }));

    const complete = host.loadScript(`Debug.Message("deferred complete " .. Duel.SpecialSummonComplete())`, "special-summon-step-defers-success-complete.lua");
    expect(complete.ok, complete.error).toBe(true);
    expect(host.messages).toContain("deferred complete 1");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "specialSummoned", eventCardUid: summoned!.uid }));
  });

  it("collects one grouped success event for multi-card SpecialSummonComplete", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Grouped Step Source", kind: "monster" },
      { code: "200", name: "Grouped Step First", kind: "monster" },
      { code: "201", name: "Grouped Step Second", kind: "monster" },
      { code: "300", name: "Grouped Step Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 201), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SpecialSummonStep(first, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
        Duel.SpecialSummonStep(second, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
        Debug.Message("group complete " .. Duel.SpecialSummonComplete())
      end)
      source:RegisterEffect(e)

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_SPSUMMON_SUCCESS)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("first own group " .. eg:GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_SPSUMMON_SUCCESS)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("second own group " .. eg:GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_SPSUMMON_SUCCESS)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg)
        Debug.Message("generic group " .. eg:GetCount())
      end)
      watcher:RegisterEffect(generic)
      `,
      "special-summon-step-grouped-success.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "201");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(host.messages).toContain("group complete 2");
    expect(session.state.pendingTriggers).toHaveLength(3);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === watcher!.uid)).toHaveLength(1);
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
    expect(host.messages).toEqual(expect.arrayContaining(["first own group 2", "second own group 2", "generic group 2"]));
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
