import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const duzaCode = "20137754";
const cubicSendCode = "201377540";
const graveFodderCode = "201377541";
const duplicateGraveCode = "201377542";
const defenderCode = "201377543";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDuzaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${duzaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceFiend = 0x8;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setCubic = 0xe3;
const effectUpdateAttack = 100;
const eventSummonSuccess = 1100;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasDuzaScript)("Lua real script Duza summon send grave flag stat", () => {
  it("restores summon Deck send, to-Grave flag registration, and Damage Step grave-code ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectDuzaScriptShape(workspace.readScript(`official/c${duzaCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 20137754, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [duzaCode, cubicSendCode, graveFodderCode, duplicateGraveCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const duza = requireCard(session, duzaCode);
    const cubicSend = requireCard(session, cubicSendCode);
    const graveFodder = requireCard(session, graveFodderCode);
    const duplicateGrave = requireCard(session, duplicateGraveCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, duza.uid, "hand", 0);
    setDeckSequence(cubicSend, 0);
    setDeckSequence(graveFodder, 1);
    setDeckSequence(duplicateGrave, 2);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(duzaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === duza.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, normalSummon!);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-1-1100", eventCardUid: duza.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: duza.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const sendCubic = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-1-1100");
    expect(sendCubic, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, sendCubic!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === cubicSend.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: duza.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: duza.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "hand", current: "monsterZone" },
      { eventCardUid: cubicSend.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: duza.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "deck", current: "graveyard" },
    ]);

    sendDuelCardToGraveyard(restoredTrigger.session.state, graveFodder.uid, 0, duelReason.effect, 0, { eventReasonCardUid: duza.uid, eventReasonEffectId: 4 });
    sendDuelCardToGraveyard(restoredTrigger.session.state, duplicateGrave.uid, 0, duelReason.effect, 0, { eventReasonCardUid: duza.uid, eventReasonEffectId: 4 });
    const restoredFlag = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredFlag);
    expectRestoredLegalActions(restoredFlag, 0);
    const battlePhase = getLuaRestoreLegalActions(restoredFlag, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredFlag, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlag, battlePhase!);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFlag.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === duza.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleAction(restoredBattle, 1, "passAttack");
    passRestoredBattleAction(restoredBattle, 0, "passAttack");
    passRestoredBattleAction(restoredBattle, 1, "passDamage");

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 0);
    const boost = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === duza.uid && action.effectId === "lua-3-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, boost!);
    resolveRestoredChain(restoredDamageStep);
    expect(currentAttack(restoredDamageStep.session.state.cards.find((card) => card.uid === duza.uid), restoredDamageStep.session.state)).toBe(2200);
    expect(restoredDamageStep.session.state.effects.filter((effect) => effect.sourceUid === duza.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: duza.uid, value: 600 }]);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: cubicSend.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: duza.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "deck", current: "graveyard" },
      { eventCardUid: graveFodder.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: duza.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "graveyard" },
      { eventCardUid: duplicateGrave.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: duza.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "graveyard" },
    ]);
    expect(restoredDamageStep.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectDuzaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Duza the Meteor Cubic Vessel");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.tgfilter,tp,LOCATION_DECK,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return e:GetHandler():GetFlagEffect(id)>0 and aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)>0");
  expect(script).toContain("local val=g:GetClassCount(Card.GetCode)*200");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: duzaCode, name: "Duza the Meteor Cubic Vessel", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1600, defense: 1600, setcodes: [setCubic] },
    { code: cubicSendCode, name: "Duza Cubic Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 800, defense: 800, setcodes: [setCubic] },
    { code: graveFodderCode, name: "Duza Grave Fodder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 900, defense: 900 },
    { code: duplicateGraveCode, name: "Duza Duplicate Grave Fodder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 700, defense: 700 },
    { code: defenderCode, name: "Duza Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.sequence = sequence;
  card.location = "deck";
  card.controller = card.owner;
  card.faceUp = false;
  card.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
