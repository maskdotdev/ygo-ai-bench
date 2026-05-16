import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
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
  const source = {
    readScript(name: string) {
      if (name === "c100.lua") return `
    c100={}
    function c100.initial_effect(c)
    ${eventCode === "EVENT_BATTLE_DESTROYING" ? sourceTriggerScript("c", eventCode, sourceRange, label) : ""}
    end
    `;
      if (name === "c200.lua") return `
    c200={}
    function c200.initial_effect(c)
    ${eventCode === "EVENT_BATTLE_DESTROYED" ? sourceTriggerScript("c", eventCode, sourceRange, label) : wrongTriggerScript("c", eventCode, wrongRange, label)}
    end
    `;
      if (name === "c300.lua") return `
    c300={}
    function c300.initial_effect(c)
    local generic_trigger=Effect.CreateEffect(c)
    generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
    generic_trigger:SetCode(${eventCode})
    generic_trigger:SetRange(LOCATION_HAND)
    generic_trigger:SetOperation(function(e,tp,eg)
      local tc=eg:GetFirst()
      Debug.Message("${label} generic battle " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
    end)
    c:RegisterEffect(generic_trigger)
    end
    `;
      if (name === "c301.lua") return `
    c301={}
    function c301.initial_effect(c)
    ${eventCode === "EVENT_BATTLE_DESTROYED" ? wrongTriggerScript("c", eventCode, wrongRange, label) : ""}
    end
    `;
      return undefined;
    },
  };
  for (const code of [100, 200, 300, 301]) {
    const loaded = host.loadCardScript(code, source);
    expect(loaded.ok, loaded.error).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(4);
  expect(sourceCard).toBeDefined();
  expect(wrongCard).toBeDefined();

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

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restored);
  const restoredBattleTriggers = restored.session.state.pendingTriggers.filter((trigger) => trigger.eventName === "battleDestroyed");
  expect(restoredBattleTriggers).toHaveLength(2);
  expect(restoredBattleTriggers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUid: expectedSource!.uid, eventCardUid: expectedEventCard!.uid, eventCode: 1140 }),
      expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: expectedEventCard!.uid, eventCode: 1140 }),
    ]),
  );
  expect(restoredBattleTriggers.some((trigger) => trigger.sourceUid === rejectedSingleSource!.uid)).toBe(false);
  activateAllRestoredTriggers(restored);

  activateAllTriggers(session);
  expect(restored.host.messages).toEqual(expect.arrayContaining(host.messages.filter((message) => message.startsWith(`${label} `))));
  return host.messages;
}

function sourceTriggerScript(card: string, eventCode: string, range: string, label: string): string {
  return `
    local source_trigger=Effect.CreateEffect(${card})
    source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
    source_trigger:SetCode(${eventCode})
    source_trigger:SetRange(${range})
    source_trigger:SetOperation(function(e,tp,eg)
      local tc=eg:GetFirst()
      Debug.Message("${label} source battle single " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
    end)
    ${card}:RegisterEffect(source_trigger)
  `;
}

function wrongTriggerScript(card: string, eventCode: string, range: string, label: string): string {
  return `
    local wrong_single=Effect.CreateEffect(${card})
    wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
    wrong_single:SetCode(${eventCode})
    wrong_single:SetRange(${range})
    wrong_single:SetOperation(function(e,tp,eg)
      Debug.Message("${label} wrong battle single " .. eg:GetCount())
    end)
    ${card}:RegisterEffect(wrong_single)
  `;
}

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
