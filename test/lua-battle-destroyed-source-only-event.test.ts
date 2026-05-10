import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only battle destroyed events", () => {
  it("binds EVENT_BATTLE_DESTROYED single triggers only to their destroyed source card", () => {
    const messages = runBattleDestroyedSourceOnly("EVENT_BATTLE_DESTROYED", "destroyed");
    expect(messages).toEqual(expect.arrayContaining(["destroyed source battle single 200/true", "destroyed generic battle 200/true"]));
    expect(messages).not.toContain("destroyed wrong battle single 1");
  });

  it("binds EVENT_BATTLE_DESTROYING alias single triggers only to the destroying source card", () => {
    const messages = runBattleDestroyedSourceOnly("EVENT_BATTLE_DESTROYING", "destroying");
    expect(messages).toEqual(expect.arrayContaining(["destroying source battle single 100/false", "destroying generic battle 100/false"]));
    expect(messages).not.toContain("destroying wrong battle single 1");
  });
});

function runBattleDestroyedSourceOnly(eventCode: string, label: string): string[] {
  const cards: DuelCardData[] = [
    { code: "100", name: "Source-Only Battle Attacker", kind: "monster", attack: 1800, defense: 1000 },
    { code: "200", name: "Source-Only Battle Target", kind: "monster", attack: 1000, defense: 1000 },
    { code: "300", name: "Battle Generic Watcher", kind: "monster" },
    { code: "301", name: "Undestroyed Battle Single Watcher", kind: "monster" },
  ];
  const session = createDuel({ seed: label === "destroyed" ? 119 : 120, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "300", "301"] }, 1: { main: ["200"] } });
  startDuel(session);

  const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
  const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
  expect(attacker).toBeDefined();
  expect(target).toBeDefined();
  moveDuelCard(session.state, attacker!.uid, "monsterZone", 0);
  attacker!.position = "faceUpAttack";
  attacker!.faceUp = true;
  moveDuelCard(session.state, target!.uid, "monsterZone", 1);
  target!.position = "faceUpAttack";
  target!.faceUp = true;

  const host = createLuaScriptHost(session);
  const sourceCard = eventCode === "EVENT_BATTLE_DESTROYING" ? "attacker" : "target";
  const sourceRange = eventCode === "EVENT_BATTLE_DESTROYING" ? "LOCATION_MZONE" : "LOCATION_GRAVE";
  const wrongCard = eventCode === "EVENT_BATTLE_DESTROYING" ? "target" : "single_watcher";
  const wrongRange = eventCode === "EVENT_BATTLE_DESTROYING" ? "LOCATION_GRAVE" : "LOCATION_HAND";
  const loaded = host.loadScript(
    `
    local attacker=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
    local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
    local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
    local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

    local source_trigger=Effect.CreateEffect(${sourceCard})
    source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
    source_trigger:SetCode(${eventCode})
    source_trigger:SetRange(${sourceRange})
    source_trigger:SetOperation(function(e,tp,eg)
      local tc=eg:GetFirst()
      Debug.Message("${label} source battle single " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
    end)
    ${sourceCard}:RegisterEffect(source_trigger)

    local generic_trigger=Effect.CreateEffect(generic_watcher)
    generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
    generic_trigger:SetCode(${eventCode})
    generic_trigger:SetRange(LOCATION_HAND)
    generic_trigger:SetOperation(function(e,tp,eg)
      local tc=eg:GetFirst()
      Debug.Message("${label} generic battle " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
    end)
    generic_watcher:RegisterEffect(generic_trigger)

    local wrong_single=Effect.CreateEffect(${wrongCard})
    wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
    wrong_single:SetCode(${eventCode})
    wrong_single:SetRange(${wrongRange})
    wrong_single:SetOperation(function(e,tp,eg)
      Debug.Message("${label} wrong battle single " .. eg:GetCount())
    end)
    ${wrongCard}:RegisterEffect(wrong_single)
    `,
    `battle-destroyed-source-only-${label}.lua`,
  );
  expect(loaded.ok, loaded.error).toBe(true);

  applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
  applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
  passBattleResponses(session);

  const genericWatcher = session.state.cards.find((card) => card.code === "300");
  const singleWatcher = session.state.cards.find((card) => card.code === "301");
  const expectedSource = eventCode === "EVENT_BATTLE_DESTROYING" ? attacker : target;
  const rejectedSingleSource = eventCode === "EVENT_BATTLE_DESTROYING" ? target : singleWatcher;
  expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  const battleTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "battleDestroyed");
  const expectedEventCard = eventCode === "EVENT_BATTLE_DESTROYING" ? attacker : target;
  expect(battleTriggers).toHaveLength(2);
  expect(battleTriggers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUid: expectedSource!.uid, eventCardUid: expectedEventCard!.uid, eventCode: 1140 }),
      expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: expectedEventCard!.uid, eventCode: 1140 }),
    ]),
  );
  expect(battleTriggers.some((trigger) => trigger.sourceUid === rejectedSingleSource!.uid)).toBe(false);

  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
  return host.messages;
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

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
