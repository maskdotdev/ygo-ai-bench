import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only pre-battle-damage events", () => {
  it("binds EVENT_PRE_BATTLE_DAMAGE single triggers only to the pending damage source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Pre Damage Attacker", kind: "monster", attack: 1800 },
      { code: "300", name: "Pre Damage Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Pre Damage Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 134, startingHandSize: 3, cardReader: createCardReader(cards) });
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
      source_trigger:SetCode(EVENT_PRE_BATTLE_DAMAGE)
      source_trigger:SetRange(LOCATION_MZONE)
      source_trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("source pre battle damage " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
      end)
      attacker:RegisterEffect(source_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_PRE_BATTLE_DAMAGE)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("generic pre battle damage " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_PRE_BATTLE_DAMAGE)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong pre battle damage " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)
      `,
      "pre-battle-damage-source-only-event.lua",
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
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(6200);
    const damageTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "beforeBattleDamage");
    expect(damageTriggers).toHaveLength(2);
    expect(damageTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: attacker!.uid, eventCardUid: attacker!.uid, eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: attacker!.uid, eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
      ]),
    );
    expect(damageTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source pre battle damage 1/100/1/1800/32/0", "generic pre battle damage 1/100/1/1800/32/0"]));
    expect(host.messages).not.toContain("wrong pre battle damage 1");
  });
});

function enterBattlePhase(session: DuelSession): void {
  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  applyAndAssert(session, battle!);
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

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
