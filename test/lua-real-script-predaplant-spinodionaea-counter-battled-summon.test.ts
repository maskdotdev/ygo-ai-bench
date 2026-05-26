import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spinodionaeaCode = "52792430";
const counterTargetCode = "527924300";
const battleTargetCode = "527924301";
const deckPredaplantCode = "527924302";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpinodionaeaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spinodionaeaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const counterPredator = 0x1041;
const setPredaplant = 0x10f3;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasSpinodionaeaScript)("Lua real script Predaplant Spinodionaea counter battled summon", () => {
  it("restores summon Predator Counter level change and battled lower-level deck summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spinodionaeaCode}.lua`));
    const reader = createCardReader(cards());

    const restoredCounter = createRestoredSummonState({ reader, workspace });
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const spinodionaea = requireCard(restoredCounter.session, spinodionaeaCode);
    const counterTarget = requireCard(restoredCounter.session, counterTargetCode);
    applyRestoredActionAndAssert(restoredCounter, requireAction(restoredCounter, spinodionaea.uid, "normalSummon"));
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: spinodionaea.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: spinodionaea.uid, triggerBucket: "turnOptional" },
    ]);
    applyRestoredActionAndAssert(restoredTrigger, requireAction(restoredTrigger, spinodionaea.uid, "activateTrigger"));
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, counterTarget.uid), counterPredator)).toBe(1);
    expect(currentLevel(findCard(restoredTrigger.session, counterTarget.uid), restoredTrigger.session.state)).toBe(1);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === counterTarget.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, value: 1 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: spinodionaea.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: counterTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: counterTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: spinodionaea.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
    ]);

    const restoredBattle = createRestoredBattleState({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleSpinodionaea = requireCard(restoredBattle.session, spinodionaeaCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const deckPredaplant = requireCard(restoredBattle.session, deckPredaplantCode);
    applyRestoredActionAndAssert(restoredBattle, requireAttack(restoredBattle, battleSpinodionaea.uid, battleTarget.uid));
    passRestoredUntilPendingTrigger(restoredBattle);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1138", eventCardUid: battleSpinodionaea.uid, eventCode: 1138, eventName: "afterDamageCalculation", eventReason: 0, eventReasonPlayer: 0, player: 0, sourceUid: battleSpinodionaea.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    applyRestoredActionAndAssert(restoredBattleTrigger, requireAction(restoredBattleTrigger, battleSpinodionaea.uid, "activateTrigger"));
    resolveRestoredChain(restoredBattleTrigger);
    expect(findCard(restoredBattleTrigger.session, deckPredaplant.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleSpinodionaea.uid,
      reasonEffectId: 3,
    });
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "specialSummoned"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "afterDamageCalculation", eventCode: 1138, eventCardUid: battleSpinodionaea.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: deckPredaplant.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleSpinodionaea.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function createRestoredSummonState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 52792430, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spinodionaeaCode] }, 1: { main: [counterTargetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, spinodionaeaCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, counterTargetCode), 1, 0);
  openMain(session);
  registerSpinodionaea(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 52792431, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [deckPredaplantCode, spinodionaeaCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, spinodionaeaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerSpinodionaea(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerSpinodionaea(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spinodionaeaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Predaplant Spinodionaea");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
  expect(script).toContain("return bc and bc:IsLevelBelow(c:GetLevel()) and bc:IsStatus(STATUS_OPPO_BATTLE) and bc:IsRelateToBattle()");
  expect(script).toContain("c:IsSetCard(SET_PREDAPLANT) and not c:IsCode(id) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: spinodionaeaCode, name: "Predaplant Spinodionaea", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, setcodes: [setPredaplant], level: 4, attack: 1800, defense: 0 },
    { code: counterTargetCode, name: "Spinodionaea Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: battleTargetCode, name: "Spinodionaea Lower-Level Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 2, attack: 100, defense: 100 },
    { code: deckPredaplantCode, name: "Spinodionaea Deck Predaplant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, setcodes: [setPredaplant], level: 3, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function openMain(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function requireAttack(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attackerUid: string, targetUid: string): DuelAction {
  const attack = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return attack!;
}

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
