import {
  addDuelChainLimit,
  applyResponse,
  collectDuelTriggerEffects,
  createDuel,
  drawDuelCards,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  moveDuelCard,
  negateDuelAttack,
  negateDuelSummon,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  startDuel,
  type CreateDuelOptions,
} from "#duel/core.js";
import { describeDuelActionSelector, duelActionMatchesSelector, selectDuelActionBySelector } from "#duel/action-selectors.js";
import { isCardPosition } from "#duel/card-kinds.js";
import { duelReason } from "#duel/reasons.js";
import { sameAction } from "#duel/response-match.js";
import type { DuelChainLimitRestoreRegistry, DuelEffectRestoreRegistry } from "#duel/snapshot.js";
import { assertActivityHistoryExpectations } from "./parity-activity-history-validation.js";
import { assertBattlePairsForWindow } from "./parity-battle-pair-validation.js";
import { assertCardExpectations } from "./parity-card-validation.js";
import { assertChainLimitExpectations } from "./parity-chain-limit-validation.js";
import { assertChainExpectations } from "./parity-chain-validation.js";
import { assertEventHistoryExpectations } from "./parity-event-history-validation.js";
import { fixtureSetupList, malformedFixtureEffectListExpectations, malformedFixtureEventListExpectations, malformedFixtureMoveListExpectations } from "./parity-fixture-effect-validation.js";
import { malformedFixtureDeckExpectations, malformedFixtureOptionsExpectations } from "./parity-fixture-options-validation.js";
import { malformedFixturePromptExpectations } from "./parity-fixture-prompt-validation.js";
import { fixtureResponseList, malformedFixtureResponseExpectations } from "./parity-fixture-response-validation.js";
import { fixtureNameForFailure, malformedFixtureExpectations, malformedWindowShapeExpectations } from "./parity-fixture-validation.js";
import { malformedGroupShapeExpectations, matchesTriggerOrderPrompt } from "./parity-group-validation.js";
import { legalActionExpectationList, legalActionGroupExpectationList } from "./parity-legal-action-list-validation.js";
import { assertLogExpectations, assertLogIncludes } from "./parity-log-validation.js";
import { assertPendingTriggerExpectations } from "./parity-pending-trigger-validation.js";
import { assertPendingTriggerBucketExpectations, matchesPendingTriggerBucket } from "./parity-trigger-bucket-validation.js";
import { isRecord, isSafeBattleStep, isSafeBoolean, isSafeCount, isSafeLocationKey, isSafePhase, isSafePlayerId, isSafePlayerKey, isSafeStatus, isSafeString, isSafeWindowId, isSafeWindowKind, isSafeWindowToken, isSafeWinner } from "./parity-validation.js";
import { assertActivityCountsForWindow, assertNumberListForWindow, assertPlayerListForWindow, assertPlayerNumberMapForWindow, assertStringListForWindow } from "./parity-window-list-validation.js";
import { assertBattleWindowForWindow, assertBooleanForWindow, assertOptionalSafeNumberForWindow, assertOptionsForWindow, assertPromptForWindow, assertSafeNumberForWindow, assertSafePlayerForWindow, assertSkippedPhasesForWindow, assertTriggerOrderPromptForWindow, assertWinnerForWindow } from "./parity-window-validation.js";
import type {
  DuelAction,
  DuelActionWindowKind,
  DuelCardInstance,
  DuelCardReader,
  DuelEffectDefinition,
  DuelEffectContext,
  DuelLocation,
  DuelResponse,
  DuelSession,
  PlayerId,
  ScriptedFixtureCardSelector,
  ScriptedDuelFixture,
  ScriptedDuelStep,
  ScriptedDuelWindowExpectation,
  ScriptedFixtureDraw,
  ScriptedFixtureEvent,
  ScriptedFixtureEffect,
  ScriptedFixtureMove,
  ScriptedLegalActionGroupExpectation,
  ScriptedLegalActionExpectation,
  ScriptedResponseSelector,
  SerializedDuelEffect,
} from "#duel/types.js";
import { isTriggerBucket, setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";

type ScriptedStepResponse = DuelResponse | ScriptedResponseSelector;
const ACTION_SELECTOR_KEYS = new Set(["attackerUid", "code", "count", "directAttack", "effectId", "labelIncludes", "location", "materialUids", "occurrence", "option", "phase", "player", "position", "promptId", "summonUids", "targetUid", "triggerBucket", "triggerId", "tributeUids", "type", "uid", "windowId", "windowKind", "windowToken", "yes"]);

export interface ParityRunOptions extends CreateDuelOptions { cardReader?: DuelCardReader; }

export interface ParityFailure { fixture: string; message: string; }

export interface ParityRunResult { ok: boolean; failures: ParityFailure[]; }

export function runScriptedDuelFixture(fixture: ScriptedDuelFixture, options: ParityRunOptions = {}): ParityRunResult {
  const failures: ParityFailure[] = [], fixtureName = fixtureNameForFailure(fixture);
  for (const message of malformedFixtureExpectations(fixture)) failures.push({ fixture: fixtureName, message });
  if (failures.length) return { ok: false, failures };
  for (const message of malformedFixtureOptionsExpectations(fixture.options)) failures.push({ fixture: fixture.name, message });
  for (const message of malformedFixtureDeckExpectations(fixture.decks)) failures.push({ fixture: fixture.name, message });
  if (failures.length) return { ok: false, failures };
  let session = createDuel({ ...fixture.options, ...options });
  loadDecks(session, fixture.decks); startDuel(session);

  const effectRegistry: DuelEffectRestoreRegistry = {}, chainLimitRegistry: DuelChainLimitRestoreRegistry = {};
  const setupMoves = fixtureSetupList("setup.moveCards", fixture.setup?.moveCards, failures, fixture.name);
  const setupEffects = fixtureSetupList("setup.effects", fixture.setup?.effects, failures, fixture.name);
  const setupEvents = fixtureSetupList("setup.collectEvents", fixture.setup?.collectEvents, failures, fixture.name);
  if (failures.length) return { ok: false, failures };
  for (const message of malformedFixtureMoveListExpectations(setupMoves)) failures.push({ fixture: fixture.name, message });
  for (const message of malformedFixturePromptExpectations(fixture.setup?.prompt)) failures.push({ fixture: fixture.name, message });
  if (failures.length) return { ok: false, failures };
  applyFixtureSetup(session, setupMoves, failures, fixture.name);
  applyFixturePrompt(session, fixture.setup?.prompt);
  applyFixtureEffects(session, setupEffects, failures, fixture.name, effectRegistry, chainLimitRegistry);
  for (const message of malformedFixtureEventListExpectations(setupEvents)) failures.push({ fixture: fixture.name, message });
  if (failures.length) return { ok: false, failures };
  applyFixtureEvents(session, setupEvents, failures, fixture.name);
  if (failures.length) return { ok: false, failures };
  const responses = fixtureResponseList(fixture.responses, failures, fixture.name);
  for (const message of malformedFixtureResponseExpectations(responses)) failures.push({ fixture: fixture.name, message });
  if (failures.length) return { ok: false, failures };
  assertWindow(session, fixture.before, fixture.name, "before fixture", failures);
  for (const step of responses) {
    const stepResponse = step.response;
    assertWindow(session, scriptedStepBefore(step), fixture.name, `before ${describeStep(stepResponse)}`, failures);
    if (scriptedStepSnapshotRestoreBefore(step)) {
      const restored = assertSnapshotRestore(session, fixture.name, `before ${describeStep(stepResponse)}`, failures, options.cardReader, effectRegistry, chainLimitRegistry);
      if (restored) session = restored;
    }
    if (failures.length) break;
    const legal = getLegalActions(session, stepResponse.player);
    const response = resolveScriptedStep(stepResponse, legal, queryPublicState(session).cards);
    if (!response) {
      failures.push({ fixture: fixture.name, message: `No legal response matched ${describeStep(stepResponse)}` });
      break;
    }
    const result = applyResponse(session, response);
    if (!result.ok) {
      failures.push({ fixture: fixture.name, message: result.error ?? `Rejected ${response.type}` });
      break;
    }
    assertWindow(session, scriptedStepAfter(step), fixture.name, `after ${describeStep(stepResponse)}`, failures);
    if (scriptedStepSnapshotRestoreAfter(step)) {
      const restored = assertSnapshotRestore(session, fixture.name, `after ${describeStep(stepResponse)}`, failures, options.cardReader, effectRegistry, chainLimitRegistry);
      if (restored) session = restored;
    }
  }

  assertWindow(session, fixture.expected, fixture.name, "final expected", failures);

  return { ok: failures.length === 0, failures };
}

export function makeResponseSelector(type: DuelResponse["type"], player: PlayerId, selector: Omit<ScriptedResponseSelector, "type" | "player"> = {}): ScriptedResponseSelector {
  return { type, player, ...selector };
}

export function makeScriptedStep(
  response: ScriptedStepResponse,
  assertions: Omit<ScriptedDuelStep, "response"> = {},
): ScriptedDuelStep { return { response, ...assertions }; }

function assertSnapshotRestore(
  session: DuelSession,
  fixture: string,
  context: string,
  failures: ParityFailure[],
  cardReader?: DuelCardReader,
  effectRegistry: DuelEffectRestoreRegistry = {},
  chainLimitRegistry: DuelChainLimitRestoreRegistry = {},
): DuelSession | undefined {
  const before = JSON.stringify(queryPublicState(session));
  const snapshot = serializeDuel(session);
  const restored = restoreDuel(snapshot, cardReader ?? session.cardReader, effectRegistry, chainLimitRegistry);
  const restoredSnapshot = serializeDuel(restored);
  const after = JSON.stringify(queryPublicState(restored));
  if (after !== before) failures.push({ fixture, message: `${context}: snapshot/restore changed public state` });
  assertSnapshotJsonEqual("serialized duel state", snapshot.state, restoredSnapshot.state, fixture, context, failures);
  if (restored.state.actionWindowId !== session.state.actionWindowId) {
    failures.push({ fixture, message: `${context}: snapshot/restore changed actionWindowId from ${session.state.actionWindowId} to ${restored.state.actionWindowId}` });
  }
  assertSnapshotJsonEqual("battleStep", session.state.battleStep, restored.state.battleStep, fixture, context, failures);
  assertSnapshotJsonEqual("battleWindow", session.state.battleWindow, restored.state.battleWindow, fixture, context, failures);
  assertSnapshotJsonEqual("pendingBattle", session.state.pendingBattle, restored.state.pendingBattle, fixture, context, failures);
  assertSnapshotJsonEqual("currentAttack", session.state.currentAttack, restored.state.currentAttack, fixture, context, failures);
  assertSnapshotJsonEqual("prompt", session.state.prompt, restored.state.prompt, fixture, context, failures);
  assertSnapshotJsonEqual("pendingTriggers", session.state.pendingTriggers, restored.state.pendingTriggers, fixture, context, failures);
  assertSnapshotJsonEqual("pendingTriggerBuckets", queryPublicState(session).pendingTriggerBuckets, queryPublicState(restored).pendingTriggerBuckets, fixture, context, failures);
  assertSnapshotJsonEqual("triggerOrderPrompt", queryPublicState(session).triggerOrderPrompt, queryPublicState(restored).triggerOrderPrompt, fixture, context, failures);
  assertSnapshotJsonEqual("eventHistory", session.state.eventHistory, restored.state.eventHistory, fixture, context, failures);
  assertSnapshotJsonEqual("chainLimits", chainLimitMetadata(session.state.chainLimits), chainLimitMetadata(restored.state.chainLimits), fixture, context, failures);
  assertSnapshotJsonEqual("chainPasses", session.state.chainPasses, restored.state.chainPasses, fixture, context, failures);
  assertSnapshotJsonEqual("attackPasses", session.state.attackPasses, restored.state.attackPasses, fixture, context, failures);
  assertSnapshotJsonEqual("damagePasses", session.state.damagePasses, restored.state.damagePasses, fixture, context, failures);
  assertSnapshotJsonEqual("battleDamage", session.state.battleDamage, restored.state.battleDamage, fixture, context, failures);
  assertSnapshotJsonEqual("usedCountKeys", session.state.usedCountKeys, restored.state.usedCountKeys, fixture, context, failures);
  assertSnapshotJsonEqual("flagEffects", session.state.flagEffects, restored.state.flagEffects, fixture, context, failures);
  assertSnapshotJsonEqual("activityCounts", session.state.activityCounts, restored.state.activityCounts, fixture, context, failures);
  assertSnapshotJsonEqual("activityHistory", session.state.activityHistory, restored.state.activityHistory, fixture, context, failures);
  assertSnapshotJsonEqual("randomCounter", session.state.randomCounter, restored.state.randomCounter, fixture, context, failures);
  assertSnapshotJsonEqual("lastDiceResults", session.state.lastDiceResults, restored.state.lastDiceResults, fixture, context, failures);
  assertSnapshotJsonEqual("lastCoinResults", session.state.lastCoinResults, restored.state.lastCoinResults, fixture, context, failures);
  assertSnapshotJsonEqual("skippedPhases", session.state.skippedPhases, restored.state.skippedPhases, fixture, context, failures);
  assertSnapshotJsonEqual("phaseActivity", session.state.phaseActivity, restored.state.phaseActivity, fixture, context, failures);
  assertSnapshotJsonEqual("globalFlags", session.state.globalFlags, restored.state.globalFlags, fixture, context, failures);
  assertSnapshotJsonEqual("duelTypeFlags", session.state.duelTypeFlags, restored.state.duelTypeFlags, fixture, context, failures);
  assertSnapshotJsonEqual("unofficialProcEnabled", session.state.unofficialProcEnabled, restored.state.unofficialProcEnabled, fixture, context, failures);
  assertSnapshotJsonEqual("shuffleCheckDisabled", session.state.shuffleCheckDisabled, restored.state.shuffleCheckDisabled, fixture, context, failures);
  assertSnapshotJsonEqual("options", session.state.options, restored.state.options, fixture, context, failures);
  assertSnapshotJsonEqual("cards", session.state.cards, restored.state.cards, fixture, context, failures);
  assertSnapshotJsonEqual("effects", snapshotEffects(snapshot.state.effects), snapshotEffects(restoredSnapshot.state.effects), fixture, context, failures);
  if (restored.state.attackCostPaid !== session.state.attackCostPaid) {
    failures.push({ fixture, message: `${context}: snapshot/restore changed attackCostPaid from ${session.state.attackCostPaid} to ${restored.state.attackCostPaid}` });
  }
  assertSnapshotJsonEqual("attacksDeclared", session.state.attacksDeclared, restored.state.attacksDeclared, fixture, context, failures);
  assertSnapshotJsonEqual("attackCanceledUids", session.state.attackCanceledUids, restored.state.attackCanceledUids, fixture, context, failures);
  assertSnapshotJsonEqual("attackedTargetUids", session.state.attackedTargetUids, restored.state.attackedTargetUids, fixture, context, failures);
  assertSnapshotJsonEqual("battlePairs", session.state.battlePairs, restored.state.battlePairs, fixture, context, failures);
  assertSnapshotJsonEqual("positionsChanged", session.state.positionsChanged, restored.state.positionsChanged, fixture, context, failures);
  for (const player of [0, 1] as const) {
    const beforeActions = JSON.stringify(getLegalActions(session, player));
    const afterActions = JSON.stringify(getLegalActions(restored, player));
    if (afterActions !== beforeActions) failures.push({ fixture, message: `${context}: snapshot/restore changed player ${player} legal actions` });
    const beforeGroups = JSON.stringify(getGroupedDuelLegalActions(session, player));
    const afterGroups = JSON.stringify(getGroupedDuelLegalActions(restored, player));
    if (afterGroups !== beforeGroups) failures.push({ fixture, message: `${context}: snapshot/restore changed player ${player} legal action groups` });
    assertLegalActionSurface(session, player, (message) => failures.push({ fixture, message: `${context}: live ${message}` }));
    assertLegalActionSurface(restored, player, (message) => failures.push({ fixture, message: `${context}: restored ${message}` }));
  }
  return failures.length === 0 ? restored : undefined;
}

function assertSnapshotJsonEqual(name: string, before: unknown, after: unknown, fixture: string, context: string, failures: ParityFailure[]): void {
  if (JSON.stringify(after) !== JSON.stringify(before)) failures.push({ fixture, message: `${context}: snapshot/restore changed ${name}` });
}

function snapshotEffects(effects: Array<DuelSession["state"]["effects"][number] | SerializedDuelEffect>): unknown[] {
  return effects.map((effect) => {
    const {
      battleDamageValue: _battleDamageValue,
      canActivate: _canActivate,
      cost: _cost,
      lifePointValue: _lifePointValue,
      operation: _operation,
      target: _target,
      targetCardPredicate: _targetCardPredicate,
      valueCardPredicate: _valueCardPredicate,
      valuePredicate: _valuePredicate,
      ...metadata
    } = effect as DuelSession["state"]["effects"][number] & Partial<SerializedDuelEffect>;
    return metadata;
  });
}

function chainLimitMetadata(chainLimits: DuelSession["state"]["chainLimits"]): Array<Pick<DuelSession["state"]["chainLimits"][number], "registryKey" | "untilChainEnd" | "expiresAtChainLength">> {
  return chainLimits.map((limit) => ({ ...(limit.registryKey === undefined ? {} : { registryKey: limit.registryKey }), untilChainEnd: limit.untilChainEnd, ...(limit.expiresAtChainLength === undefined ? {} : { expiresAtChainLength: limit.expiresAtChainLength }) }));
}

function assertWindow(session: DuelSession, expected: ScriptedDuelWindowExpectation | undefined, fixture: string, context: string, failures: ParityFailure[]): void {
  if (!expected) return;
  const state = queryPublicState(session);
  const label = expectationLabel(expected);
  const fail = (message: string) => failures.push({ fixture, message: `${context}${label}: ${message}` });
  for (const message of malformedWindowShapeExpectations(expected)) fail(message);
  if (expected.status !== undefined && !isSafeStatus(expected.status)) fail(`Expected status has malformed value ${expected.status}`);
  else if (expected.status !== undefined && state.status !== expected.status) fail(`Expected status ${expected.status}, got ${state.status}`);
  assertWinnerForWindow(state.winner, expected.winner, fail);
  assertOptionalSafeNumberForWindow("winReason", state.winReason, expected.winReason, fail);
  if (assertSafeNumberForWindow("windowId", expected.windowId, fail) && session.state.actionWindowId !== expected.windowId) fail(`Expected windowId ${expected.windowId}, got ${session.state.actionWindowId}`);
  if (expected.windowKind !== undefined && !isSafeWindowKind(expected.windowKind)) fail(`Expected windowKind has malformed value ${expected.windowKind}`);
  else if (expected.windowKind !== undefined && currentWindowKind(session) !== expected.windowKind) fail(`Expected windowKind ${expected.windowKind}, got ${currentWindowKind(session) ?? "none"}`);
  if (assertSafePlayerForWindow("waitingFor", expected.waitingFor, fail) && state.waitingFor !== expected.waitingFor) fail(`Expected waitingFor ${expected.waitingFor}, got ${state.waitingFor}`);
  if (assertSafeNumberForWindow("turn", expected.turn, fail) && state.turn !== expected.turn) fail(`Expected turn ${expected.turn}, got ${state.turn}`);
  if (assertSafePlayerForWindow("turnPlayer", expected.turnPlayer, fail) && state.turnPlayer !== expected.turnPlayer) fail(`Expected turnPlayer ${expected.turnPlayer}, got ${state.turnPlayer}`);
  if (expected.phase !== undefined && !isSafePhase(expected.phase)) fail(`Expected phase has malformed value ${expected.phase}`);
  else if (expected.phase !== undefined && state.phase !== expected.phase) fail(`Expected phase ${expected.phase}, got ${state.phase}`);
  if (assertSafeNumberForWindow("randomCounter", expected.randomCounter, fail) && session.state.randomCounter !== expected.randomCounter) fail(`Expected randomCounter ${expected.randomCounter}, got ${session.state.randomCounter}`);
  assertNumberListForWindow("lastDiceResults", session.state.lastDiceResults, expected.lastDiceResults, fail);
  assertNumberListForWindow("lastCoinResults", session.state.lastCoinResults, expected.lastCoinResults, fail);
  assertPlayerNumberMapForWindow("lifePoints", { 0: state.players[0].lifePoints, 1: state.players[1].lifePoints }, expected.lifePoints, fail);
  assertActivityCountsForWindow(state.activityCounts, expected.activityCounts, fail);
  assertActivityHistoryExpectations(session.state.activityHistory, expected.activityHistory, fail);
  assertSkippedPhasesForWindow(session.state.skippedPhases, expected.skippedPhases, fail);
  assertBooleanForWindow("phaseActivity", session.state.phaseActivity, expected.phaseActivity, fail);
  assertPlayerNumberMapForWindow("battleDamage", session.state.battleDamage, expected.battleDamage, fail);
  if (assertSafeNumberForWindow("attackCostPaid", expected.attackCostPaid, fail) && session.state.attackCostPaid !== expected.attackCostPaid) fail(`Expected attackCostPaid ${expected.attackCostPaid}, got ${session.state.attackCostPaid}`);
  assertOptionsForWindow(session.state.options, expected.options, fail);
  if (assertSafeNumberForWindow("duelTypeFlags", expected.duelTypeFlags, fail) && session.state.duelTypeFlags !== expected.duelTypeFlags) fail(`Expected duelTypeFlags ${expected.duelTypeFlags}, got ${session.state.duelTypeFlags}`);
  if (assertSafeNumberForWindow("globalFlags", expected.globalFlags, fail) && session.state.globalFlags !== expected.globalFlags) fail(`Expected globalFlags ${expected.globalFlags}, got ${session.state.globalFlags}`);
  assertBooleanForWindow("unofficialProcEnabled", session.state.unofficialProcEnabled, expected.unofficialProcEnabled, fail);
  assertBooleanForWindow("shuffleCheckDisabled", session.state.shuffleCheckDisabled, expected.shuffleCheckDisabled, fail);
  assertStringListForWindow("usedCountKeys", session.state.usedCountKeys, expected.usedCountKeys, fail);
  if (expected.battleStep !== undefined && !isSafeBattleStep(expected.battleStep)) fail(`Expected battleStep has malformed value ${expected.battleStep}`);
  else if (expected.battleStep !== undefined && state.battleStep !== expected.battleStep) fail(`Expected battleStep ${expected.battleStep}, got ${state.battleStep}`);
  assertBattleWindowForWindow(state.battleWindow, expected.battleWindow, fail);
  assertBooleanForWindow("pendingBattle", Boolean(session.state.pendingBattle), expected.pendingBattle, fail);
  assertBooleanForWindow("currentAttack", Boolean(session.state.currentAttack), expected.currentAttack, fail);
  assertPromptForWindow(state.prompt, expected.prompt, fail);
  assertTriggerOrderPromptForWindow(queryPublicState(session).triggerOrderPrompt, expected.triggerOrderPrompt, fail);
  assertChainLimitExpectations(chainLimitMetadata(session.state.chainLimits), expected.chainLimits, fail);
  assertPlayerListForWindow("chainPasses", session.state.chainPasses, expected.chainPasses, fail);
  assertPlayerListForWindow("attackPasses", state.attackPasses, expected.attackPasses, fail);
  assertPlayerListForWindow("damagePasses", state.damagePasses, expected.damagePasses, fail);
  assertChainExpectations(state.chain, expected.chain, fail);
  assertPendingTriggerExpectations(state.pendingTriggers, expected.pendingTriggers, fail);
  assertPendingTriggerBucketExpectations(queryPublicState(session).pendingTriggerBuckets, expected.pendingTriggerBuckets, fail);
  assertEventHistoryExpectations(session.state.eventHistory, expected.eventHistory, fail);
  const expectedLegalActions = legalActionExpectationList("legalActions", expected.legalActions, fail);
  const expectedAbsentLegalActions = legalActionExpectationList("absentLegalActions", expected.absentLegalActions, fail);
  const expectedLegalActionGroups = legalActionGroupExpectationList("legalActionGroups", expected.legalActionGroups, fail);
  const expectedAbsentLegalActionGroups = legalActionGroupExpectationList("absentLegalActionGroups", expected.absentLegalActionGroups, fail);
  assertLegalActionCounts(session, expected.legalActionCounts, fail);
  assertLegalActionGroupCounts(session, expected.legalActionGroupCounts, fail);
  assertLegalActionGroupsFlattenLegalActions(session, expected, expectedLegalActions, expectedAbsentLegalActions, expectedLegalActionGroups, expectedAbsentLegalActionGroups, fail);
  assertLegalActionWindowStamps(session, expected, expectedLegalActions, expectedAbsentLegalActions, expectedLegalActionGroups, expectedAbsentLegalActionGroups, fail);
  assertLogIncludes(state.log, expected.logIncludes, fail);
  const cards = state.cards;
  if (expectedLegalActions.length) assertLegalActions("Expected legal action", session, expectedLegalActions, cards, fail, false);
  if (expectedLegalActionGroups.length) assertLegalActionGroups("Expected legal action group", session, expectedLegalActionGroups, cards, fail, false);
  if (expectedAbsentLegalActions.length) assertLegalActions("Expected no legal action", session, expectedAbsentLegalActions, cards, fail, true);
  if (expectedAbsentLegalActionGroups.length) assertLegalActionGroups("Expected no legal action group", session, expectedAbsentLegalActionGroups, cards, fail, true);
  assertLocationExpectations(cards, expected.locations, expected.locationCounts, fail);
  assertCardExpectations(cardsWithMovementMetadata(session, cards), expected.cards, fail);
  assertStringListForWindow("positionsChanged", state.positionsChanged, expected.positionsChanged, fail);
  assertStringListForWindow("attacksDeclared", state.attacksDeclared, expected.attacksDeclared, fail);
  assertStringListForWindow("attackCanceledUids", state.attackCanceledUids, expected.attackCanceledUids, fail);
  assertStringListForWindow("attackedTargetUids", state.attackedTargetUids, expected.attackedTargetUids, fail);
  assertBattlePairsForWindow(state.battlePairs, expected.battlePairs, fail);
  if (assertSafeNumberForWindow("logCount", expected.logCount, fail) && state.log.length !== expected.logCount) fail(`Expected log count ${expected.logCount}, got ${state.log.length}`);
  assertLogExpectations(state.log, expected.log, fail);
}

function currentWindowKind(session: DuelSession): DuelActionWindowKind | undefined { return queryPublicState(session).windowKind; }

function expectationLabel(expected: ScriptedDuelWindowExpectation): string { const source = ` (${expected.source})`; const note = expected.note ? ` [${expected.note}]` : ""; return `${source}${note}`; }

function assertLegalActionCounts(session: DuelSession, expected: Partial<Record<PlayerId, number>> | undefined, fail: (message: string) => void): void {
  if (expected !== undefined && !isRecord(expected)) return void fail(`Expected legal action count has malformed value ${String(expected)}`);
  for (const [player, expectedCount] of Object.entries(expected ?? {}) as [string, number][]) {
    if (!isSafePlayerKey(player)) { fail(`Expected legal action count has malformed player ${player}`); continue; }
    if (!isSafeCount(expectedCount)) { fail(`Expected player ${player} legal action count has malformed count ${expectedCount}`); continue; }
    const actualCount = getLegalActions(session, Number(player) as PlayerId).length;
    if (actualCount !== expectedCount) fail(`Expected player ${player} legal action count ${expectedCount}, got ${actualCount}`);
  }
}

function assertLegalActionGroupCounts(session: DuelSession, expected: Partial<Record<PlayerId, number>> | undefined, fail: (message: string) => void): void {
  if (expected !== undefined && !isRecord(expected)) return void fail(`Expected legal action group count has malformed value ${String(expected)}`);
  for (const [player, expectedCount] of Object.entries(expected ?? {}) as [string, number][]) {
    if (!isSafePlayerKey(player)) { fail(`Expected legal action group count has malformed player ${player}`); continue; }
    if (!isSafeCount(expectedCount)) { fail(`Expected player ${player} legal action group count has malformed count ${expectedCount}`); continue; }
    const actualCount = getGroupedDuelLegalActions(session, Number(player) as PlayerId).length;
    if (actualCount !== expectedCount) fail(`Expected player ${player} legal action group count ${expectedCount}, got ${actualCount}`);
  }
}

function assertLegalActionGroupsFlattenLegalActions(
  session: DuelSession,
  expected: ScriptedDuelWindowExpectation,
  expectedLegalActions: ScriptedLegalActionExpectation[],
  expectedAbsentLegalActions: ScriptedLegalActionExpectation[],
  expectedLegalActionGroups: ScriptedLegalActionGroupExpectation[],
  expectedAbsentLegalActionGroups: ScriptedLegalActionGroupExpectation[],
  fail: (message: string) => void,
): void {
  for (const player of expectedLegalActionPlayers(expected, expectedLegalActions, expectedAbsentLegalActions, expectedLegalActionGroups, expectedAbsentLegalActionGroups)) {
    assertLegalActionSurface(session, player, fail);
  }
}

function assertLegalActionWindowStamps(
  session: DuelSession,
  expected: ScriptedDuelWindowExpectation,
  expectedLegalActions: ScriptedLegalActionExpectation[],
  expectedAbsentLegalActions: ScriptedLegalActionExpectation[],
  expectedLegalActionGroups: ScriptedLegalActionGroupExpectation[],
  expectedAbsentLegalActionGroups: ScriptedLegalActionGroupExpectation[],
  fail: (message: string) => void,
): void {
  for (const player of expectedLegalActionPlayers(expected, expectedLegalActions, expectedAbsentLegalActions, expectedLegalActionGroups, expectedAbsentLegalActionGroups)) {
    assertLegalActionWindowStampsForPlayer(session, player, fail);
  }
}

function assertLegalActionSurface(session: DuelSession, player: PlayerId, fail: (message: string) => void): void {
  const legalActions = getLegalActions(session, player);
  const groupedActions = getGroupedDuelLegalActions(session, player).flatMap((group) => group.actions);
  if (JSON.stringify(groupedActions) !== JSON.stringify(legalActions)) fail(`Expected player ${player} legal action groups to flatten to legal actions`);
  assertLegalActionWindowStampsForPlayer(session, player, fail);
}

function assertLegalActionWindowStampsForPlayer(session: DuelSession, player: PlayerId, fail: (message: string) => void): void {
  const windowKind = currentWindowKind(session);
  for (const action of getLegalActions(session, player)) {
    if (action.windowId !== session.state.actionWindowId || action.windowKind !== windowKind) {
      fail(`Expected player ${player} legal action ${action.type} to be stamped with window ${session.state.actionWindowId}/${windowKind ?? "none"}`);
    }
    if (action.windowToken !== session.state.actionWindowToken) {
      fail(`Expected player ${player} legal action ${action.type} to be stamped with token ${session.state.actionWindowToken}`);
    }
  }
  for (const group of getGroupedDuelLegalActions(session, player)) {
    if (group.windowId !== session.state.actionWindowId || group.windowKind !== windowKind) {
      fail(`Expected player ${player} legal action group ${group.label} to be stamped with window ${session.state.actionWindowId}/${windowKind ?? "none"}`);
    }
    if (group.windowToken !== session.state.actionWindowToken) {
      fail(`Expected player ${player} legal action group ${group.label} to be stamped with token ${session.state.actionWindowToken}`);
    }
  }
}

function expectedLegalActionPlayers(
  expected: ScriptedDuelWindowExpectation,
  expectedLegalActions: ScriptedLegalActionExpectation[],
  expectedAbsentLegalActions: ScriptedLegalActionExpectation[],
  expectedLegalActionGroups: ScriptedLegalActionGroupExpectation[],
  expectedAbsentLegalActionGroups: ScriptedLegalActionGroupExpectation[],
): Set<PlayerId> {
  const players = new Set<PlayerId>();
  for (const player of Object.keys(isRecord(expected.legalActionCounts) ? expected.legalActionCounts : {})) addExpectedLegalActionPlayer(players, Number(player));
  for (const player of Object.keys(isRecord(expected.legalActionGroupCounts) ? expected.legalActionGroupCounts : {})) addExpectedLegalActionPlayer(players, Number(player));
  for (const action of expectedLegalActions) addExpectedLegalActionPlayer(players, action.player);
  for (const action of expectedAbsentLegalActions) addExpectedLegalActionPlayer(players, action.player);
  for (const group of expectedLegalActionGroups) addExpectedLegalActionPlayer(players, group.player);
  for (const group of expectedAbsentLegalActionGroups) addExpectedLegalActionPlayer(players, group.player);
  return players;
}

function addExpectedLegalActionPlayer(players: Set<PlayerId>, player: number): void {
  if (isSafePlayerId(player as PlayerId)) players.add(player as PlayerId);
}

function assertLocationExpectations(
  cards: { code: string; location: DuelLocation }[],
  locations: Partial<Record<DuelLocation, string[]>> | undefined,
  locationCounts: Partial<Record<DuelLocation, Record<string, number>>> | undefined,
  fail: (message: string) => void,
): void {
  if (locations !== undefined && !isRecord(locations)) fail(`Expected locations has malformed value ${String(locations)}`);
  if (locationCounts !== undefined && !isRecord(locationCounts)) fail(`Expected locationCounts has malformed value ${String(locationCounts)}`);
  const safeLocations = isRecord(locations) ? locations : undefined;
  const safeLocationCounts = isRecord(locationCounts) ? locationCounts : undefined;
  for (const [location, expectedCodes] of Object.entries(safeLocations ?? {}) as [DuelLocation, string[]][]) {
    if (!isSafeLocationKey(location)) { fail(`Expected locations has malformed location ${location}`); continue; }
    if (!Array.isArray(expectedCodes)) { fail(`Expected locations[${location}] has malformed value ${String(expectedCodes)}`); continue; }
    const actualCodes = cards.filter((card) => card.location === location).map((card) => card.code);
    for (const code of expectedCodes) {
      if (!isSafeString(code)) { fail(`Expected locations[${location}] has malformed code ${String(code)}`); continue; }
      if (!actualCodes.includes(code)) fail(`Expected ${code} in ${location}`);
    }
  }
  for (const [location, expectedCounts] of Object.entries(safeLocationCounts ?? {}) as [DuelLocation, Record<string, number>][]) {
    if (!isSafeLocationKey(location)) { fail(`Expected locationCounts has malformed location ${location}`); continue; }
    if (!isRecord(expectedCounts)) { fail(`Expected locationCounts[${location}] has malformed value ${String(expectedCounts)}`); continue; }
    const actualCounts = countCodes(cards.filter((card) => card.location === location).map((card) => card.code));
    for (const [code, expectedCount] of Object.entries(expectedCounts)) {
      if (!isSafeCount(expectedCount)) { fail(`Expected ${code} in ${location} has malformed count ${expectedCount}`); continue; }
      const actualCount = actualCounts.get(code) ?? 0;
      if (actualCount !== expectedCount) fail(`Expected ${expectedCount} ${code} in ${location}, got ${actualCount}`);
    }
  }
}

function cardsWithMovementMetadata(
  session: DuelSession,
  cards: Array<{ uid: string }>,
): Array<{ uid: string; reason?: number; reasonPlayer?: PlayerId; reasonCardUid?: string; reasonEffectId?: number }> {
  const internalCards = new Map(session.state.cards.map((card) => [card.uid, card]));
  return cards.map((card) => {
    const internalCard = internalCards.get(card.uid);
    return {
      ...card,
      ...(internalCard?.reason === undefined ? {} : { reason: internalCard.reason }),
      ...(internalCard?.reasonPlayer === undefined ? {} : { reasonPlayer: internalCard.reasonPlayer }),
      ...(internalCard?.reasonCardUid === undefined ? {} : { reasonCardUid: internalCard.reasonCardUid }),
      ...(internalCard?.reasonEffectId === undefined ? {} : { reasonEffectId: internalCard.reasonEffectId }),
    };
  });
}

function assertLegalActions(
  prefix: string,
  session: DuelSession,
  expected: ScriptedLegalActionExpectation[],
  cards: { uid: string; code: string; location: DuelLocation }[],
  fail: (message: string) => void,
  absent: boolean,
): void {
  for (const expectation of expected) {
    if (!isSafePlayerId(expectation.player)) {
      fail(`${prefix} ${describeStep(expectation)} has malformed player ${expectation.player}`);
      continue;
    }
    if (expectation.count !== undefined && !isSafeCount(expectation.count)) {
      fail(`${prefix} ${describeStep(expectation)} has malformed count ${expectation.count}`);
      continue;
    }
    const malformedWindowField = malformedActionWindowField(expectation);
    if (malformedWindowField) {
      fail(`${prefix} ${describeStep(expectation)} has malformed ${malformedWindowField}`);
      continue;
    }
    const malformedSelectorField = malformedActionSelectorField(expectation);
    if (malformedSelectorField) {
      fail(`${prefix} ${describeStep(expectation)} has malformed ${malformedSelectorField}`);
      continue;
    }
    const legal = getLegalActions(session, expectation.player);
    const matches = legal.filter((action) => duelActionMatchesSelector(action, expectation, cards));
    const expectedCount = expectation.count;
    if (absent ? matches.length > 0 : expectedCount === undefined ? matches.length === 0 : matches.length !== expectedCount) {
      fail(`${prefix} ${describeStep(expectation)} matched ${matches.length}${expectedCount === undefined ? "" : `, expected ${expectedCount}`}`);
    }
  }
}

function assertLegalActionGroups(
  prefix: string,
  session: DuelSession,
  expected: ScriptedLegalActionGroupExpectation[],
  cards: { uid: string; code: string; location: DuelLocation }[],
  fail: (message: string) => void,
  absent: boolean,
): void {
  for (const expectation of expected) {
    const malformedPlayerExpectation = malformedGroupPlayerExpectation(expectation);
    if (malformedPlayerExpectation) {
      fail(`${prefix} ${malformedPlayerExpectation.description} has malformed player ${malformedPlayerExpectation.player}`);
      continue;
    }
    const malformedCountExpectation = malformedGroupCountExpectation(expectation);
    if (malformedCountExpectation) {
      fail(`${prefix} ${malformedCountExpectation.description} has malformed count ${malformedCountExpectation.count}`);
      continue;
    }
    const malformedShapeExpectations = malformedGroupShapeExpectations(expectation, describeGroupExpectation(expectation));
    if (malformedShapeExpectations.length) {
      for (const malformed of malformedShapeExpectations) fail(`${prefix} ${malformed}`);
      continue;
    }
    const malformedWindowExpectation = malformedGroupWindowExpectation(expectation);
    if (malformedWindowExpectation) {
      fail(`${prefix} ${malformedWindowExpectation.description} has malformed ${malformedWindowExpectation.field}`);
      continue;
    }
    const malformedSelectorExpectation = malformedGroupSelectorExpectation(expectation);
    if (malformedSelectorExpectation) {
      fail(`${prefix} ${malformedSelectorExpectation.description} has malformed ${malformedSelectorExpectation.field}`);
      continue;
    }
    const groups = getGroupedDuelLegalActions(session, expectation.player);
    const matches = groups.filter((group) => legalActionGroupMatches(group, expectation, cards));
    const expectedCount = expectation.count;
    if (absent ? matches.length > 0 : expectedCount === undefined ? matches.length === 0 : matches.length !== expectedCount) {
      fail(`${prefix} ${describeGroupExpectation(expectation)} matched ${matches.length}${expectedCount === undefined ? "" : `, expected ${expectedCount}`}`);
    }
  }
}

function legalActionGroupMatches(
  group: ReturnType<typeof getGroupedDuelLegalActions>[number],
  expectation: ScriptedLegalActionGroupExpectation,
  cards: { uid: string; code: string; location: DuelLocation }[],
): boolean {
  if (expectation.key !== undefined && group.key !== expectation.key) return false;
  if (expectation.label !== undefined && group.label !== expectation.label) return false;
  if (expectation.windowId !== undefined && !isSafeWindowId(expectation.windowId)) return false;
  if (expectation.windowId !== undefined && group.windowId !== expectation.windowId) return false;
  if (expectation.windowKind !== undefined && group.windowKind !== expectation.windowKind) return false;
  if (expectation.windowToken !== undefined && group.windowToken !== expectation.windowToken) return false;
  if (expectation.triggerBucket !== undefined && !matchesPendingTriggerBucket(group.triggerBucket, expectation.triggerBucket)) return false;
  if (expectation.triggerOrderPrompt !== undefined && !matchesTriggerOrderPrompt(group.triggerOrderPrompt, expectation.triggerOrderPrompt)) return false;
  for (const actionExpectation of groupActionExpectations(expectation)) {
    if (!isSafePlayerId(actionExpectation.player)) return false;
    if (actionExpectation.count !== undefined && !isSafeCount(actionExpectation.count)) return false;
    if (malformedActionSelectorField(actionExpectation)) return false;
    const matches = group.actions.filter((action) => duelActionMatchesSelector(action, actionExpectation, cards));
    const expectedCount = actionExpectation.count;
    if (expectedCount === undefined ? matches.length === 0 : matches.length !== expectedCount) return false;
  }
  return true;
}

function malformedActionWindowField(expectation: ScriptedResponseSelector): string | undefined {
  if (expectation.windowId !== undefined && !isSafeWindowId(expectation.windowId)) return "windowId"; if (expectation.windowKind !== undefined && !isSafeWindowKind(expectation.windowKind)) return "windowKind"; if (expectation.windowToken !== undefined && !isSafeWindowToken(expectation.windowToken)) return "windowToken"; return undefined;
}

function malformedActionSelectorField(expectation: ScriptedResponseSelector): string | undefined {
  const unknownKey = Object.keys(expectation).find((key) => !ACTION_SELECTOR_KEYS.has(key));
  if (unknownKey !== undefined) return `key ${unknownKey}`;
  if (expectation.code !== undefined && !isSafeString(expectation.code)) return "code";
  if (expectation.uid !== undefined && !isSafeString(expectation.uid)) return "uid";
  if (expectation.tributeUids !== undefined && !isStringList(expectation.tributeUids)) return "tributeUids";
  if (expectation.materialUids !== undefined && !isStringList(expectation.materialUids)) return "materialUids";
  if (expectation.summonUids !== undefined && !isStringList(expectation.summonUids)) return "summonUids";
  if (expectation.position !== undefined && !isCardPosition(expectation.position)) return "position";
  if (expectation.phase !== undefined && !isSafePhase(expectation.phase)) return "phase";
  if (expectation.attackerUid !== undefined && !isSafeString(expectation.attackerUid)) return "attackerUid";
  if (expectation.targetUid !== undefined && !isSafeString(expectation.targetUid)) return "targetUid";
  if (expectation.directAttack !== undefined && !isSafeBoolean(expectation.directAttack)) return "directAttack";
  if (expectation.promptId !== undefined && !isSafeWindowToken(expectation.promptId)) return "promptId";
  if (expectation.option !== undefined && !isSafeCount(expectation.option)) return "option";
  if (expectation.yes !== undefined && !isSafeBoolean(expectation.yes)) return "yes";
  if (expectation.effectId !== undefined && !isSafeString(expectation.effectId)) return "effectId";
  if (expectation.triggerId !== undefined && !isSafeString(expectation.triggerId)) return "triggerId";
  if (expectation.triggerBucket !== undefined && !isTriggerBucket(expectation.triggerBucket)) return "triggerBucket";
  if (expectation.location !== undefined && !isSafeLocationKey(expectation.location)) return "location";
  if (expectation.labelIncludes !== undefined && !isSafeWindowToken(expectation.labelIncludes)) return "labelIncludes";
  if (expectation.occurrence !== undefined && !isSafeCount(expectation.occurrence)) return "occurrence";
  return undefined;
}

function isStringList(value: string[]): boolean {
  return Array.isArray(value) && value.every(isSafeString);
}

function malformedGroupWindowExpectation(expectation: ScriptedLegalActionGroupExpectation): { description: string; field: string } | undefined {
  if (expectation.windowId !== undefined && !isSafeWindowId(expectation.windowId)) return { description: describeGroupExpectation(expectation), field: "windowId" };
  if (expectation.windowKind !== undefined && !isSafeWindowKind(expectation.windowKind)) return { description: describeGroupExpectation(expectation), field: "windowKind" };
  if (expectation.windowToken !== undefined && !isSafeWindowToken(expectation.windowToken)) return { description: describeGroupExpectation(expectation), field: "windowToken" };
  for (const action of groupActionExpectations(expectation)) {
    const field = malformedActionWindowField(action);
    if (field) return { description: `${describeGroupExpectation(expectation)} action ${describeStep(action)}`, field };
  }
  return undefined;
}

function malformedGroupSelectorExpectation(expectation: ScriptedLegalActionGroupExpectation): { description: string; field: string } | undefined {
  for (const action of groupActionExpectations(expectation)) {
    const field = malformedActionSelectorField(action);
    if (field) return { description: `${describeGroupExpectation(expectation)} action ${describeStep(action)}`, field };
  }
  return undefined;
}

function malformedGroupCountExpectation(expectation: ScriptedLegalActionGroupExpectation): { description: string; count: number } | undefined {
  if (expectation.count !== undefined && !isSafeCount(expectation.count)) return { description: describeGroupExpectation(expectation), count: expectation.count };
  for (const action of groupActionExpectations(expectation)) {
    if (action.count !== undefined && !isSafeCount(action.count)) return { description: `${describeGroupExpectation(expectation)} action ${describeStep(action)}`, count: action.count };
  }
  return undefined;
}

function malformedGroupPlayerExpectation(expectation: ScriptedLegalActionGroupExpectation): { description: string; player: PlayerId } | undefined {
  if (!isSafePlayerId(expectation.player)) return { description: describeGroupExpectation(expectation), player: expectation.player };
  for (const action of groupActionExpectations(expectation)) if (!isSafePlayerId(action.player)) return { description: `${describeGroupExpectation(expectation)} action ${describeStep(action)}`, player: action.player };
  return undefined;
}

function groupActionExpectations(expectation: ScriptedLegalActionGroupExpectation): ScriptedLegalActionExpectation[] {
  return Array.isArray(expectation.actions) ? expectation.actions.filter(isRecord) as ScriptedLegalActionExpectation[] : [];
}

function resolveScriptedStep(step: ScriptedStepResponse, legal: DuelAction[], cards: { uid: string; code: string; location: DuelLocation }[]): DuelAction | undefined {
  if (isConcreteResponse(step)) {
    const action = legal.find((candidate) => sameAction(candidate, step));
    return action ? withMatchedWindowStamp(step, action) : undefined;
  }
  const selector = step as ScriptedResponseSelector;
  const action = selectDuelActionBySelector(legal, selector, cards);
  if (action?.type === "pendulumSummon" && selector.summonUids !== undefined) return { ...action, summonUids: [...selector.summonUids] };
  return action;
}

function withMatchedWindowStamp(step: DuelAction, action: DuelAction): DuelAction {
  if (action.windowToken === undefined) return step;
  return { ...step, windowId: action.windowId, windowKind: action.windowKind, windowToken: action.windowToken } as DuelAction;
}

function isConcreteResponse(step: ScriptedStepResponse): step is DuelAction {
  if (step.type === "pendulumSummon") return false;
  if (step.type === "changePhase") return "phase" in step && "label" in step;
  return "label" in step && (!("uid" in step) || typeof step.uid === "string");
}

function scriptedStepBefore(step: ScriptedDuelStep): ScriptedDuelWindowExpectation | undefined {
  return step.before;
}

function scriptedStepAfter(step: ScriptedDuelStep): ScriptedDuelWindowExpectation | undefined {
  return step.after;
}

function scriptedStepSnapshotRestoreBefore(step: ScriptedDuelStep): boolean {
  return step.snapshotRestore === true || step.snapshotRestore === "before" || step.snapshotRestore === "both";
}

function scriptedStepSnapshotRestoreAfter(step: ScriptedDuelStep): boolean {
  return step.snapshotRestore === "after" || step.snapshotRestore === "both";
}

function applyFixtureEffects(
  session: DuelSession,
  effects: ScriptedFixtureEffect[],
  failures: ParityFailure[],
  fixture: string,
  effectRegistry: DuelEffectRestoreRegistry,
  chainLimitRegistry: DuelChainLimitRestoreRegistry,
): void {
  for (const [index, effect] of effects.entries()) {
    if (!isRecord(effect)) {
      failures.push({ fixture, message: `setup.effects[${index}] has malformed value ${String(effect)}` });
      return;
    }
    for (const message of malformedFixtureEffectListExpectations(effect)) {
      failures.push({ fixture, message: `Setup effect ${effect.id} ${message}` });
    }
    if (failures.length) return;
    if (effect.occurrence !== undefined && !isSafeCount(effect.occurrence)) return void failures.push({ fixture, message: `Setup effect source ${effect.code} for player ${effect.player} has malformed occurrence ${effect.occurrence}` });
    const cards = queryPublicState(session).cards.filter((card) => {
      if (card.controller !== effect.player || card.code !== effect.code) return false;
      return effect.location === undefined || card.location === effect.location;
    });
    const source = cards[effect.occurrence ?? 0];
    if (!source) {
      failures.push({ fixture, message: `Setup could not find effect source ${effect.code} for player ${effect.player}` });
      return;
    }
    const registryKey = `fixture:${fixture}:${effect.id}:${source.uid}`;
    const chainLimitRegistryKey = `fixture-chain-limit:${fixture}:${effect.id}:${source.uid}`;
    effectRegistry[registryKey] = (serialized) => createFixtureEffectDefinition(effect, serialized.sourceUid, registryKey, effect.chainLimitOnTarget ? chainLimitRegistryKey : undefined);
    if (effect.chainLimitOnTarget) {
      chainLimitRegistry[chainLimitRegistryKey] = (serialized) => createFixtureChainLimit(effect, chainLimitRegistryKey, serialized.expiresAtChainLength);
    }
    registerEffect(session, createFixtureEffectDefinition(effect, source.uid, registryKey, effect.chainLimitOnTarget ? chainLimitRegistryKey : undefined));
  }
}

function createFixtureEffectDefinition(effect: ScriptedFixtureEffect, sourceUid: string, registryKey: string, chainLimitRegistryKey?: string): DuelEffectDefinition {
  const hasTargetHandler = effect.chainLimitOnTarget !== undefined || effect.targetCardsOnActivation !== undefined;
  const canActivate = createFixtureCanActivate(effect);
  return {
    id: effect.id,
    sourceUid,
    registryKey,
    controller: effect.player,
    event: effect.event,
    range: effect.range,
    ...(effect.effectCode === undefined ? {} : { code: effect.effectCode }),
    ...(effect.luaTypeFlags === undefined ? {} : { luaTypeFlags: effect.luaTypeFlags }),
    ...(effect.value === undefined ? {} : { value: effect.value }),
    ...(effect.valueCardCode === undefined ? {} : { valueCardPredicate: (_ctx, card) => card.code === effect.valueCardCode }),
    ...(effect.targetCardCode === undefined ? {} : { targetCardPredicate: (_ctx, card) => card.code === effect.targetCardCode }),
    ...(effect.targetRange === undefined ? {} : { targetRange: effect.targetRange }),
    ...(effect.triggerEvent === undefined ? {} : { triggerEvent: effect.triggerEvent }),
    ...(effect.triggerCode === undefined ? {} : { triggerCode: effect.triggerCode }),
    ...(effect.triggerTiming === undefined ? {} : { triggerTiming: effect.triggerTiming }),
    ...(effect.optional === undefined ? {} : { optional: effect.optional }),
    ...(effect.oncePerTurn === undefined ? {} : { oncePerTurn: effect.oncePerTurn }),
    ...(effect.property === undefined ? {} : { property: effect.property }),
    ...(canActivate === undefined ? {} : { canActivate }),
    ...(hasTargetHandler
      ? {
          target(ctx) {
            const targets = targetFixtureCards(ctx.duel, effect.targetCardsOnActivation);
            if (targets === undefined) return false;
            if (targets.length > 0) ctx.setTargets(targets.map((card) => card.uid));
            if (!ctx.checkOnly && effect.chainLimitOnTarget) addDuelChainLimit(ctx.duel, createFixtureChainLimit(effect, chainLimitRegistryKey ?? "", undefined));
            return true;
          },
        }
      : {}),
    operation(ctx) {
      const timingBoundaryStart = effect.targetCardsOnActivation === undefined ? undefined : fixtureOperationTriggerStart(ctx);
      let operationMoved = timingBoundaryStart !== undefined && timingBoundaryStart < ctx.duel.pendingTriggers.length;
      for (const event of effect.collectEventsOnResolve ?? []) {
        if (timingBoundaryStart !== undefined) markFixtureOperationTimingBoundary(ctx.duel, timingBoundaryStart, operationMoved);
        const eventCard = event.eventCard === undefined ? undefined : findFixtureCard(ctx.duel, event.eventCard);
        if (event.eventCard !== undefined && !eventCard) throw new Error(`Fixture effect could not find event card ${event.eventCard.code} for player ${event.eventCard.player}`);
        collectDuelTriggerEffects(ctx.duel, event.collectEvent, eventCard, fixtureEventPayload(event));
        operationMoved = true;
      }
      for (const draw of effect.drawCardsOnResolve ?? []) {
        if (timingBoundaryStart !== undefined) markFixtureOperationTimingBoundary(ctx.duel, timingBoundaryStart, operationMoved);
        operationMoved = drawDuelCards(ctx.duel, draw.player, draw.count, draw.detail ?? "Fixture draw", fixtureDrawEventPayload(draw)) > 0 || operationMoved;
      }
      for (const move of effect.moveCardsOnResolve ?? []) {
        if (timingBoundaryStart !== undefined) markFixtureOperationTimingBoundary(ctx.duel, timingBoundaryStart, operationMoved);
        if (move.occurrence !== undefined && !isSafeCount(move.occurrence)) throw new Error(`Fixture effect move ${move.code} for player ${move.player} has malformed occurrence ${move.occurrence}`);
        const candidates = ctx.duel.cards
          .filter((card) => {
            if (card.controller !== move.player || card.code !== move.code) return false;
            return move.from === undefined || card.location === move.from;
          })
          .sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence);
        const card = candidates[move.occurrence ?? 0];
        if (!card) {
          throw new Error(`Fixture effect could not move ${move.code} for player ${move.player}`);
        }
        const moved = moveDuelCard(ctx.duel, card.uid, move.to, move.controller, move.moveReason ?? duelReason.effect, move.moveReasonPlayer);
        applyFixturePosition(moved, move.position);
        if (move.collectEvent) {
          collectDuelTriggerEffects(ctx.duel, move.collectEvent, moved, fixtureMoveEventPayload(move));
        }
        operationMoved = true;
      }
      if (effect.negateChainEffectOnResolve) {
        const target = ctx.duel.chain.find((link) => link.effectId === effect.negateChainEffectOnResolve);
        ctx.log(`Negated chain ${Boolean(target && ctx.negateChainLink(target.id))}`);
      }
      if (effect.negateAttackOnResolve) ctx.log(`Negated attack ${negateDuelAttack(ctx.duel)}`);
      if (effect.negateSummonOnResolve) ctx.log(`Negated summon ${Boolean(negateFixtureSummon(ctx.duel, effect.negateSummonOnResolve))}`);
      if (effect.logMessage) ctx.log(effect.logMessage);
    },
  };
}

function createFixtureCanActivate(effect: ScriptedFixtureEffect): DuelEffectDefinition["canActivate"] | undefined {
  if (effect.activationChain === undefined && effect.eventCardCode === undefined) return undefined;
  return (ctx) => {
    if (effect.activationChain !== undefined && (effect.activationChain === "chain" ? ctx.duel.chain.length === 0 : ctx.duel.chain.length > 0)) return false;
    if (effect.eventCardCode !== undefined && ctx.eventCard?.code !== effect.eventCardCode) return false;
    return true;
  };
}

function targetFixtureCards(state: DuelSession["state"], selectors: ScriptedFixtureCardSelector[] | undefined): DuelCardInstance[] | undefined {
  if (selectors === undefined) return [];
  const targets: DuelCardInstance[] = [];
  for (const selector of selectors) {
    const card = findFixtureCard(state, selector);
    if (!card) return undefined;
    targets.push(card);
  }
  return targets;
}

function findFixtureCard(state: DuelSession["state"], selector: ScriptedFixtureCardSelector): DuelCardInstance | undefined {
  if (selector.occurrence !== undefined && !isSafeCount(selector.occurrence)) return undefined;
  const candidates = state.cards
    .filter((card) => {
      if (card.controller !== selector.player || card.code !== selector.code) return false;
      return selector.location === undefined || card.location === selector.location;
    })
    .sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence);
  return candidates[selector.occurrence ?? 0];
}

function fixtureOperationTriggerStart(ctx: DuelEffectContext): number {
  if (ctx.chainLink?.id === undefined) return ctx.duel.pendingTriggers.length;
  const index = ctx.duel.pendingTriggers.findIndex((trigger) => trigger.eventName === "becameTarget" && trigger.eventChainLinkId === ctx.chainLink?.id);
  return index < 0 ? ctx.duel.pendingTriggers.length : index;
}

function markFixtureOperationTimingBoundary(state: DuelSession["state"], start: number, operationMoved: boolean): void {
  if (!operationMoved) return;
  const before = state.pendingTriggers.length;
  state.pendingTriggers = state.pendingTriggers.filter((trigger, index) => {
    if (index < start) return true;
    const effect = state.effects.find((candidate) => candidate.id === trigger.effectId && candidate.sourceUid === trigger.sourceUid);
    return effect?.optional === false || effect?.triggerTiming !== "when";
  });
  if (state.pendingTriggers.length !== before) setWaitingForPendingTriggerBucket(state);
}

function negateFixtureSummon(state: DuelSession["state"], target: NonNullable<ScriptedFixtureEffect["negateSummonOnResolve"]>) {
  if (target.occurrence !== undefined && !isSafeCount(target.occurrence)) return undefined;
  const candidates = state.cards
    .filter((card) => {
      if (card.controller !== target.player || card.code !== target.code) return false;
      return target.location === undefined || card.location === target.location;
    })
    .sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence);
  const card = candidates[target.occurrence ?? 0];
  return card ? negateDuelSummon(state, card.uid) : undefined;
}

function createFixtureChainLimit(effect: ScriptedFixtureEffect, registryKey: string, expiresAtChainLength: number | undefined): DuelSession["state"]["chainLimits"][number] {
  return {
    registryKey,
    untilChainEnd: Boolean(effect.chainLimitOnTarget?.untilChainEnd),
    ...(expiresAtChainLength === undefined ? {} : { expiresAtChainLength }),
    allows(_effect, player) {
      return effect.chainLimitOnTarget?.allowPlayer === undefined || player === effect.chainLimitOnTarget.allowPlayer;
    },
  };
}

function applyFixtureSetup(session: DuelSession, moves: ScriptedFixtureMove[], failures: ParityFailure[], fixture: string): void {
  for (const move of moves) {
    if (move.occurrence !== undefined && !isSafeCount(move.occurrence)) return void failures.push({ fixture, message: `Setup move ${move.code} for player ${move.player} has malformed occurrence ${move.occurrence}` });
    const cards = queryPublicState(session).cards.filter((card) => {
      if (card.controller !== move.player || card.code !== move.code) return false;
      return move.from === undefined || card.location === move.from;
    });
    const card = cards[move.occurrence ?? 0];
    if (!card) {
      failures.push({ fixture, message: `Setup could not find ${move.code} for player ${move.player}` });
      return;
    }
    const moved = moveDuelCard(session.state, card.uid, move.to, move.controller, move.moveReason, move.moveReasonPlayer);
    applyFixturePosition(moved, move.position);
    if (move.collectEvent) collectDuelTriggerEffects(session.state, move.collectEvent, moved, fixtureMoveEventPayload(move));
  }
}

function applyFixtureEvents(session: DuelSession, events: ScriptedFixtureEvent[], failures: ParityFailure[], fixture: string): void {
  for (const event of events) {
    const eventCard = event.eventCard === undefined ? undefined : findFixtureCard(session.state, event.eventCard);
    if (event.eventCard !== undefined && !eventCard) {
      failures.push({ fixture, message: `Setup could not find event card ${event.eventCard.code} for player ${event.eventCard.player}` });
      return;
    }
    collectDuelTriggerEffects(session.state, event.collectEvent, eventCard, fixtureEventPayload(event));
  }
}

function applyFixturePosition(card: Pick<DuelCardInstance, "position" | "faceUp">, position: ScriptedFixtureMove["position"]): void {
  if (!position) return;
  card.position = position;
  card.faceUp = position !== "faceDown" && position !== "faceDownDefense";
}

function fixtureMoveEventPayload(move: ScriptedFixtureMove) {
  return fixtureEventPayload(move);
}

function fixtureDrawEventPayload(draw: ScriptedFixtureDraw) {
  return {
    ...(draw.eventIsLast === undefined ? {} : { eventIsLast: draw.eventIsLast }),
    ...(draw.eventReason === undefined ? {} : { eventReason: draw.eventReason }),
    ...(draw.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: draw.eventReasonPlayer }),
    ...(draw.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: draw.eventReasonCardUid }),
    ...(draw.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: draw.eventReasonEffectId }),
  };
}

function fixtureEventPayload(event: ScriptedFixtureMove | ScriptedFixtureEvent) {
  return {
    ...(event.eventCode === undefined ? {} : { eventCode: event.eventCode }),
    ...(event.eventIsLast === undefined ? {} : { eventIsLast: event.eventIsLast }),
    ...(event.eventPlayer === undefined ? {} : { eventPlayer: event.eventPlayer }),
    ...(event.eventValue === undefined ? {} : { eventValue: event.eventValue }),
    ...(event.eventReason === undefined ? {} : { eventReason: event.eventReason }),
    ...(event.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: event.eventReasonPlayer }),
    ...(event.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: event.eventReasonCardUid }),
    ...(event.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: event.eventReasonEffectId }),
    ...(event.relatedEffectId === undefined ? {} : { relatedEffectId: event.relatedEffectId }),
    ...(event.eventChainDepth === undefined ? {} : { eventChainDepth: event.eventChainDepth }),
    ...(event.eventChainLinkId === undefined ? {} : { eventChainLinkId: event.eventChainLinkId }),
    ...(event.eventUids === undefined || event.eventUids.length === 0 ? {} : { eventUids: [...event.eventUids] }),
  };
}

function applyFixturePrompt(session: DuelSession, prompt: DuelSession["state"]["prompt"] | undefined): void {
  if (!prompt) return;
  session.state.prompt = prompt.type === "selectOption" ? { ...prompt, options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }) } : { ...prompt };
  session.state.waitingFor = prompt.player;
}

function describeStep(step: ScriptedStepResponse): string {
  if (!isConcreteResponse(step)) return describeDuelActionSelector(step);
  const detail = [
    `type=${step.type}`,
    `player=${step.player}`,
    "windowId" in step && step.windowId !== undefined ? `windowId=${step.windowId}` : undefined,
    "windowKind" in step && step.windowKind !== undefined ? `windowKind=${step.windowKind}` : undefined,
    "windowToken" in step && step.windowToken !== undefined ? `windowToken=${step.windowToken}` : undefined,
    "code" in step && step.code !== undefined ? `code=${step.code}` : undefined,
    "uid" in step && step.uid !== undefined ? `uid=${step.uid}` : undefined,
    "tributeUids" in step && step.tributeUids ? `tributeUids=${step.tributeUids.join(",")}` : undefined,
    "materialUids" in step && step.materialUids ? `materialUids=${step.materialUids.join(",")}` : undefined,
    "summonUids" in step && step.summonUids ? `summonUids=${step.summonUids.join(",")}` : undefined,
    "position" in step && step.position !== undefined ? `position=${step.position}` : undefined,
    "phase" in step && step.phase !== undefined ? `phase=${step.phase}` : undefined,
    "attackerUid" in step && step.attackerUid !== undefined ? `attackerUid=${step.attackerUid}` : undefined,
    "targetUid" in step && step.targetUid !== undefined ? `targetUid=${step.targetUid}` : undefined,
    "promptId" in step && step.promptId !== undefined ? `promptId=${step.promptId}` : undefined,
    "option" in step && step.option !== undefined ? `option=${step.option}` : undefined,
    "yes" in step && step.yes !== undefined ? `yes=${step.yes}` : undefined,
    "effectId" in step && step.effectId !== undefined ? `effectId=${step.effectId}` : undefined,
    "triggerId" in step && step.triggerId !== undefined ? `triggerId=${step.triggerId}` : undefined,
    "location" in step && step.location !== undefined ? `location=${step.location}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}

function describeGroupExpectation(expectation: ScriptedLegalActionGroupExpectation): string {
  const detail = [
    `player=${expectation.player}`,
    expectation.key !== undefined ? `key=${expectation.key}` : undefined,
    expectation.label !== undefined ? `label=${expectation.label}` : undefined,
    expectation.windowId !== undefined ? `windowId=${expectation.windowId}` : undefined,
    expectation.windowKind !== undefined ? `windowKind=${expectation.windowKind}` : undefined,
    expectation.windowToken !== undefined ? `windowToken=${expectation.windowToken}` : undefined,
    expectation.triggerBucket !== undefined ? `triggerBucket=${JSON.stringify(expectation.triggerBucket)}` : undefined,
    expectation.triggerOrderPrompt !== undefined ? `triggerOrderPrompt=${JSON.stringify(expectation.triggerOrderPrompt)}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}

function countCodes(codes: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}
