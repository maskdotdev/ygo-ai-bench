import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelEffectDefinition } from "#duel/types.js";

const pendulumCards: DuelCardData[] = [
  { code: "100", name: "Grouped Pendulum Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "200", name: "Grouped Pendulum High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "300", name: "Grouped Pendulum First", kind: "monster", typeFlags: 0x1000001, level: 4 },
  { code: "301", name: "Grouped Pendulum Second", kind: "monster", typeFlags: 0x1000001, level: 5 },
  { code: "400", name: "Grouped Pendulum Watcher", kind: "monster" },
];

describe("Pendulum Summon grouped success events", () => {
  it("collects one grouped success event for core multi-card Pendulum Summons", () => {
    const session = setupPendulumSession();
    const first = cardByCode(session, "300");
    const second = cardByCode(session, "301");
    const watcher = cardByCode(session, "400");
    registerEffect(session, specialSummonedTrigger("core-first", first.uid, ["monsterZone"], true));
    registerEffect(session, specialSummonedTrigger("core-second", second.uid, ["monsterZone"], true));
    registerEffect(session, specialSummonedTrigger("core-generic", watcher.uid, ["hand"]));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "pendulumSummon" && candidate.summonUids.includes(first.uid) && candidate.summonUids.includes(second.uid));
    expect(action?.type).toBe("pendulumSummon");
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    applyAndAssert(session, { ...action, summonUids: [first.uid, second.uid] });

    expect(session.state.pendingTriggers).toHaveLength(3);
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first.uid, second.uid]);
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectId: "core-first", eventCardUid: first.uid }),
        expect.objectContaining({ effectId: "core-second", eventCardUid: second.uid }),
        expect.objectContaining({ effectId: "core-generic", eventCardUid: first.uid }),
      ]),
    );
    activateAllTriggers(session);
    expect(session.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining(["core-first 2", "core-second 2", "core-generic 2"]));
  });

  it("collects one grouped success event for Lua multi-card PendulumSummon", () => {
    const session = setupPendulumSession();
    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_SPSUMMON_SUCCESS)
      first_trigger:SetRange(LOCATION_MZONE)
      first_trigger:SetOperation(function(e,tp,eg) Debug.Message("lua first group " .. eg:GetCount()) end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_SPSUMMON_SUCCESS)
      second_trigger:SetRange(LOCATION_MZONE)
      second_trigger:SetOperation(function(e,tp,eg) Debug.Message("lua second group " .. eg:GetCount()) end)
      second:RegisterEffect(second_trigger)

      local generic=Effect.CreateEffect(watcher)
      generic:SetType(EFFECT_TYPE_TRIGGER_O)
      generic:SetCode(EVENT_SPSUMMON_SUCCESS)
      generic:SetRange(LOCATION_HAND)
      generic:SetOperation(function(e,tp,eg) Debug.Message("lua generic group " .. eg:GetCount()) end)
      watcher:RegisterEffect(generic)
      Debug.Message("lua pendulum summon " .. Duel.PendulumSummon(0))
      `,
      "pendulum-summon-grouped-success.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = cardByCode(session, "300");
    const second = cardByCode(session, "301");
    expect(host.messages).toContain("lua pendulum summon 2");
    expect(session.state.pendingTriggers).toHaveLength(3);
    const eventUids = session.state.pendingTriggers[0]?.eventUids ?? [];
    expect(eventUids).toHaveLength(2);
    expect(eventUids).toEqual(expect.arrayContaining([first.uid, second.uid]));
    for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual(eventUids);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["lua first group 2", "lua second group 2", "lua generic group 2"]));
  });
});

function setupPendulumSession() {
  const session = createDuel({ seed: 277, startingHandSize: 5, cardReader: createCardReader(pendulumCards) });
  loadDecks(session, { 0: { main: ["100", "200", "300", "301", "400"] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, cardByCode(session, "100").uid, "spellTrapZone", 0).sequence = 0;
  moveDuelCard(session.state, cardByCode(session, "200").uid, "spellTrapZone", 0).sequence = 1;
  return session;
}

function specialSummonedTrigger(id: string, sourceUid: string, range: DuelEffectDefinition["range"], triggerSourceOnly = false): DuelEffectDefinition {
  return {
    id,
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "specialSummoned",
    ...(triggerSourceOnly ? { triggerSourceOnly: true } : {}),
    range,
    operation(ctx) {
      ctx.log(`${id} ${ctx.eventUids?.length ?? 0}`);
    },
  };
}

function cardByCode(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function activateAllTriggers(session: ReturnType<typeof createDuel>) {
  for (;;) {
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) return;
    applyAndAssert(session, trigger);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  return response;
}
