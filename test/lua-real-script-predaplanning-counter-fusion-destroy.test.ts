import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeFusion } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const predaplanningCode = "44536921";
const costPredaplantCode = "445369210";
const ownFaceupCode = "445369211";
const opponentFaceupCode = "445369212";
const darkFusionCode = "445369213";
const destroyTargetCode = "445369214";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPredaplanningScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${predaplanningCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeFusion = 0x40;
const racePlant = 0x400;
const raceWarrior = 0x1;
const setPredaplant = 0x10f3;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const counterPredator = 0x1041;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasPredaplanningScript)("Lua real script Predaplanning counter fusion destroy", () => {
  it("restores Predaplanning deck cost, Predator Counters, level change, and grave DARK Fusion destroy trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${predaplanningCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredCounter = createRestoredCounterField(reader, workspace);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const predaplanning = requireCard(restoredCounter.session, predaplanningCode);
    const costPredaplant = requireCard(restoredCounter.session, costPredaplantCode);
    const ownFaceup = requireCard(restoredCounter.session, ownFaceupCode);
    const opponentFaceup = requireCard(restoredCounter.session, opponentFaceupCode);
    const activate = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateEffect" && action.uid === predaplanning.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, activate!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);

    expect(findCard(restoredCounter.session, costPredaplant.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: predaplanning.uid,
      reasonEffectId: 1,
    });
    expect(getDuelCardCounter(findCard(restoredCounter.session, ownFaceup.uid), counterPredator)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredCounter.session, opponentFaceup.uid), counterPredator)).toBe(1);
    expect(currentLevel(findCard(restoredCounter.session, ownFaceup.uid), restoredCounter.session.state)).toBe(1);
    expect(currentLevel(findCard(restoredCounter.session, opponentFaceup.uid), restoredCounter.session.state)).toBe(1);
    expect(restoredCounter.session.state.effects.filter((effect) => [ownFaceup.uid, opponentFaceup.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: ownFaceup.uid, value: 1 },
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentFaceup.uid, value: 1 },
    ]);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["sentToGraveyard", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCardUid: costPredaplant.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: predaplanning.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCardUid: ownFaceup.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: predaplanning.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCardUid: opponentFaceup.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: predaplanning.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCardUid: predaplanning.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredDestroy = createRestoredDestroyField(reader, workspace);
    expectCleanRestore(restoredDestroy);
    const gravePredaplanning = requireCard(restoredDestroy.session, predaplanningCode);
    const darkFusion = requireCard(restoredDestroy.session, darkFusionCode);
    const destroyTarget = requireCard(restoredDestroy.session, destroyTargetCode);
    specialSummonDuelCard(restoredDestroy.session.state, darkFusion.uid, 0, 0, {}, luaSummonTypeFusion, true, true);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: darkFusion.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: gravePredaplanning.uid, triggerBucket: "turnOptional" },
    ]);
    const destroyTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === gravePredaplanning.uid && action.effectId === "lua-2-1102"
    );
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, destroyTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);
    expect(findCard(restoredTrigger.session, gravePredaplanning.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: gravePredaplanning.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredTrigger.session, darkFusion.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gravePredaplanning.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredTrigger.session, destroyTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "banished", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCardUid: darkFusion.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "banished", eventCardUid: gravePredaplanning.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: gravePredaplanning.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCardUid: darkFusion.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "destroyed", eventCardUid: darkFusion.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gravePredaplanning.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: predaplanningCode, name: "Predaplanning", kind: "trap", typeFlags: typeTrap },
    { code: costPredaplantCode, name: "Predaplanning Cost Predaplant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, setcodes: [setPredaplant], level: 4, attack: 1000, defense: 1000 },
    { code: ownFaceupCode, name: "Predaplanning Own Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: opponentFaceupCode, name: "Predaplanning Opponent Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: darkFusionCode, name: "Predaplanning DARK Fusion Trigger", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: racePlant, attribute: attributeDark, level: 6, attack: 2200, defense: 1800 },
    { code: destroyTargetCode, name: "Predaplanning Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1400 },
  ];
}

function createRestoredCounterField(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = setupDuel(reader);
  loadDecks(session, { 0: { main: [predaplanningCode, costPredaplantCode, ownFaceupCode] }, 1: { main: [opponentFaceupCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, predaplanningCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownFaceupCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentFaceupCode), 1, 0);
  setOpenMainPhase(session);
  registerPredaplanning(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyField(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = setupDuel(reader);
  loadDecks(session, { 0: { main: [predaplanningCode, destroyTargetCode], extra: [darkFusionCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, predaplanningCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, destroyTargetCode), 1, 0);
  setOpenMainPhase(session);
  registerPredaplanning(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  return createDuel({ seed: 44536921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
}

function setOpenMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerPredaplanning(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(predaplanningCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplanning");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thcfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,0,COUNTER_PREDATOR)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_DARK) and c:GetSummonPlayer()==tp and c:IsFusionSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.sequence = sequence;
  return moved;
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
