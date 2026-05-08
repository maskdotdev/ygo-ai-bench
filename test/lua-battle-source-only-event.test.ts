import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only battle events", () => {
  it("binds EVENT_ATTACK_ANNOUNCE single triggers only to the attacking source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Attack Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Attack Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 128, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(attacker)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_ATTACK_ANNOUNCE)
      source_trigger:SetRange(LOCATION_MZONE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source attack announce " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      attacker:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_ATTACK_ANNOUNCE)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic attack announce " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_ATTACK_ANNOUNCE)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong attack announce " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "attack-announce-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    enterBattlePhase(session);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);

    const attackTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "attackDeclared");
    expect(attackTriggers).toHaveLength(2);
    expect(attackTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: attacker!.uid, eventCardUid: attacker!.uid, eventCode: 1130 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: attacker!.uid, eventCode: 1130 }),
      ]),
    );
    expect(attackTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source attack announce 1/100", "generic attack announce 1/100"]));
    expect(host.messages).not.toContain("wrong attack announce 1");
  });

  it("binds EVENT_BE_BATTLE_TARGET single triggers only to the targeted source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Source-Only Battle Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Battle Target Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Battle Target Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 129, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "301"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(target)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_BE_BATTLE_TARGET)
      source_trigger:SetRange(LOCATION_MZONE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source battle target " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      target:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_BE_BATTLE_TARGET)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic battle target " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_BE_BATTLE_TARGET)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong battle target " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "battle-target-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    enterBattlePhase(session);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);

    const targetTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "battleTargeted");
    expect(targetTriggers).toHaveLength(2);
    expect(targetTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: target!.uid, eventCardUid: target!.uid, eventCode: 1131 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: target!.uid, eventCode: 1131 }),
      ]),
    );
    expect(targetTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source battle target 1/200", "generic battle target 1/200"]));
    expect(host.messages).not.toContain("wrong battle target 1");
  });
});

function enterBattlePhase(session: DuelSession): void {
  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  applyAndAssert(session, battle!);
}

function activateAllTriggers(session: DuelSession): void {
  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
  drainChain(session);
}

function drainChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
