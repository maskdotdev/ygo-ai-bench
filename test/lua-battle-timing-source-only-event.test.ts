import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelEventName, DuelSession } from "#duel/types.js";

describe("Lua source-only battle timing events", () => {
  it("binds single battle timing triggers only to cards participating in battle", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Timing Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Battle Timing Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Battle Timing Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Battle Timing Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 135, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local codes={
        EVENT_BATTLE_START,
        EVENT_BATTLE_CONFIRM,
        EVENT_PRE_DAMAGE_CALCULATE,
        EVENT_DAMAGE_CALCULATING,
        EVENT_BATTLED,
        EVENT_BATTLE_END,
        EVENT_DAMAGE_STEP_END
      }
      local labels={
        "start",
        "confirm",
        "precalc",
        "calculating",
        "battled",
        "end",
        "stepend"
      }

      for i,code in ipairs(codes) do
        local label=labels[i]

        local attacker_trigger=Effect.CreateEffect(attacker)
        attacker_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        attacker_trigger:SetCode(code)
        attacker_trigger:SetRange(LOCATION_MZONE)
        attacker_trigger:SetOperation(function(e,tp,eg)
          Debug.Message("attacker " .. label .. " " .. eg:GetCount())
        end)
        attacker:RegisterEffect(attacker_trigger)

        local target_trigger=Effect.CreateEffect(target)
        target_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        target_trigger:SetCode(code)
        target_trigger:SetRange(LOCATION_MZONE)
        target_trigger:SetOperation(function(e,tp,eg)
          Debug.Message("target " .. label .. " " .. eg:GetCount())
        end)
        target:RegisterEffect(target_trigger)

        local generic_trigger=Effect.CreateEffect(generic_watcher)
        generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
        generic_trigger:SetCode(code)
        generic_trigger:SetRange(LOCATION_HAND)
        generic_trigger:SetOperation(function(e,tp,eg)
          Debug.Message("generic " .. label .. " " .. eg:GetCount())
        end)
        generic_watcher:RegisterEffect(generic_trigger)

        local wrong_single=Effect.CreateEffect(single_watcher)
        wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
        wrong_single:SetCode(code)
        wrong_single:SetRange(LOCATION_HAND)
        wrong_single:SetOperation(function(e,tp,eg)
          Debug.Message("wrong " .. label .. " " .. eg:GetCount())
        end)
        single_watcher:RegisterEffect(wrong_single)
      end
      `,
      "battle-timing-source-only-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(genericWatcher).toBeDefined();
    expect(singleWatcher).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    enterBattlePhase(session);
    applyAndAssert(
      session,
      getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === target!.uid)!,
    );

    passBattleResponsePair(session);
    assertTimingTriggers(session, "battleStarted", 1132, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    assertTimingTriggers(session, "battleConfirmed", 1133, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["attacker start 2", "target start 2", "generic start 2", "attacker confirm 2", "target confirm 2", "generic confirm 2"]));
    expect(host.messages.some((message) => message.startsWith("wrong start ") || message.startsWith("wrong confirm "))).toBe(false);

    passBattleResponsePair(session);
    assertTimingTriggers(session, "beforeDamageCalculation", 1134, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["attacker precalc 2", "target precalc 2", "generic precalc 2"]));
    expect(host.messages.some((message) => message.startsWith("wrong precalc "))).toBe(false);

    passBattleResponsePair(session);
    assertTimingTriggers(session, "damageCalculating", 1135, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["attacker calculating 2", "target calculating 2", "generic calculating 2"]));
    expect(host.messages.some((message) => message.startsWith("wrong calculating "))).toBe(false);

    passBattleResponsePair(session);
    assertTimingTriggers(session, "afterDamageCalculation", 1138, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["attacker battled 2", "target battled 2", "generic battled 2"]));
    expect(host.messages.some((message) => message.startsWith("wrong battled "))).toBe(false);

    passBattleResponsePair(session);
    assertTimingTriggers(session, "battleEnded", 1137, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    assertTimingTriggers(session, "damageStepEnded", 1141, attacker!.uid, target!.uid, genericWatcher!.uid, singleWatcher!.uid);
    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["attacker end 2", "target end 2", "generic end 2", "attacker stepend 2", "target stepend 2", "generic stepend 2"]));
    expect(host.messages.some((message) => message.startsWith("wrong end ") || message.startsWith("wrong stepend "))).toBe(false);
  });
});

function assertTimingTriggers(
  session: DuelSession,
  eventName: DuelEventName,
  eventCode: number,
  attackerUid: string,
  targetUid: string,
  genericWatcherUid: string,
  singleWatcherUid: string,
): void {
  const triggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === eventName);
  expect(triggers).toHaveLength(3);
  expect(triggers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUid: attackerUid, eventCardUid: attackerUid, eventCode, eventUids: [attackerUid, targetUid] }),
      expect.objectContaining({ sourceUid: targetUid, eventCardUid: targetUid, eventCode, eventUids: [attackerUid, targetUid] }),
      expect.objectContaining({ sourceUid: genericWatcherUid, eventCode, eventUids: [attackerUid, targetUid] }),
    ]),
  );
  expect(triggers.some((trigger) => trigger.sourceUid === singleWatcherUid)).toBe(false);
}

function enterBattlePhase(session: DuelSession): void {
  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  applyAndAssert(session, battle!);
}

function passBattleResponsePair(session: DuelSession): void {
  for (let passes = 0; passes < 2; passes += 1) {
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
