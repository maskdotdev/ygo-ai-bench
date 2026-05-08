import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only attack-disabled events", () => {
  it("binds EVENT_ATTACK_DISABLED single triggers only to the negated attacking source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Disabled Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Attack Disabled Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Attack Disabled Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Attack Disabled Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 132, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"] }, 1: { main: ["200"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.currentAttack = { attackerUid: attacker!.uid, targetUid: target!.uid };
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: target!.uid };

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local source_trigger=Effect.CreateEffect(attacker)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_ATTACK_DISABLED)
      source_trigger:SetRange(LOCATION_MZONE)
      source_trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("source attack disabled " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. r .. "/" .. rp)
      end)
      attacker:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_ATTACK_DISABLED)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("generic attack disabled " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. r .. "/" .. rp)
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_ATTACK_DISABLED)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong attack disabled " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "attack-disabled-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    const negated = host.loadScript(`Debug.Message("negate disabled " .. tostring(Duel.NegateAttack()))`, "negate-attack-disabled-source-only.lua");
    expect(negated.ok, negated.error).toBe(true);
    expect(host.messages).toContain("negate disabled true");

    const disabledTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "attackDisabled");
    expect(disabledTriggers).toHaveLength(2);
    expect(disabledTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: attacker!.uid, eventCardUid: attacker!.uid, eventCode: 1142, eventPlayer: 0, eventReason: 0x40, eventReasonPlayer: 0 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: attacker!.uid, eventCode: 1142, eventPlayer: 0, eventReason: 0x40, eventReasonPlayer: 0 }),
      ]),
    );
    expect(disabledTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source attack disabled 1/100/0/64/0", "generic attack disabled 1/100/0/64/0"]));
    expect(host.messages).not.toContain("wrong attack disabled 1");
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

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
