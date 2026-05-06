import {
  addDuelChainLimit,
  applyResponse,
  collectDuelTriggerEffects,
  createDuel,
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
import { sameStringMembers } from "#duel/string-list-match.js";
import type { DuelChainLimitRestoreRegistry, DuelEffectRestoreRegistry } from "#duel/snapshot.js";
import type {
  DuelAction,
  DuelActionWindowKind,
  DuelCardInstance,
  DuelCardReader,
  DuelEffectDefinition,
  DuelLocation,
  PendingTriggerBucketState,
  DuelResponse,
  DuelSession,
  PlayerId,
  ScriptedDuelFixture,
  ScriptedDuelStep,
  ScriptedDuelWindowExpectation,
  ScriptedFixtureEffect,
  ScriptedFixtureMove,
  ScriptedLegalActionGroupExpectation,
  ScriptedLegalActionExpectation,
  ScriptedResponseSelector,
  SerializedDuelEffect,
} from "#duel/types.js";

type ScriptedStepResponse = DuelResponse | ScriptedResponseSelector;

export interface ParityRunOptions extends CreateDuelOptions {
  cardReader?: DuelCardReader;
}

export interface ParityFailure {
  fixture: string;
  message: string;
}

export interface ParityRunResult {
  ok: boolean;
  failures: ParityFailure[];
}

export function runScriptedDuelFixture(fixture: ScriptedDuelFixture, options: ParityRunOptions = {}): ParityRunResult {
  let session = createDuel({ ...fixture.options, ...options });
  loadDecks(session, fixture.decks);
  startDuel(session);

  const failures: ParityFailure[] = [];
  const effectRegistry: DuelEffectRestoreRegistry = {};
  const chainLimitRegistry: DuelChainLimitRestoreRegistry = {};
  applyFixtureSetup(session, fixture.setup?.moveCards ?? [], failures, fixture.name);
  applyFixturePrompt(session, fixture.setup?.prompt);
  applyFixtureEffects(session, fixture.setup?.effects ?? [], failures, fixture.name, effectRegistry, chainLimitRegistry);
  if (failures.length) return { ok: false, failures };
  assertWindow(session, fixture.before, fixture.name, "before fixture", failures);
  for (const step of fixture.responses) {
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
): ScriptedDuelStep {
  return { response, ...assertions };
}

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
  return chainLimits.map((limit) => ({
    ...(limit.registryKey === undefined ? {} : { registryKey: limit.registryKey }),
    untilChainEnd: limit.untilChainEnd,
    ...(limit.expiresAtChainLength === undefined ? {} : { expiresAtChainLength: limit.expiresAtChainLength }),
  }));
}

function assertWindow(session: DuelSession, expected: ScriptedDuelWindowExpectation | undefined, fixture: string, context: string, failures: ParityFailure[]): void {
  if (!expected) return;
  const state = queryPublicState(session);
  const label = expectationLabel(expected);
  const fail = (message: string) => failures.push({ fixture, message: `${context}${label}: ${message}` });
  if (expected.status !== undefined && state.status !== expected.status) fail(`Expected status ${expected.status}, got ${state.status}`);
  assertOptionalValueForWindow("winner", state.winner, expected.winner, fail);
  assertOptionalValueForWindow("winReason", state.winReason, expected.winReason, fail);
  if (expected.windowId !== undefined && session.state.actionWindowId !== expected.windowId) fail(`Expected windowId ${expected.windowId}, got ${session.state.actionWindowId}`);
  if (expected.windowKind !== undefined) {
    const actualWindowKind = currentWindowKind(session);
    if (actualWindowKind !== expected.windowKind) fail(`Expected windowKind ${expected.windowKind}, got ${actualWindowKind ?? "none"}`);
  }
  if (expected.waitingFor !== undefined && state.waitingFor !== expected.waitingFor) fail(`Expected waitingFor ${expected.waitingFor}, got ${state.waitingFor}`);
  if (expected.turn !== undefined && state.turn !== expected.turn) fail(`Expected turn ${expected.turn}, got ${state.turn}`);
  if (expected.turnPlayer !== undefined && state.turnPlayer !== expected.turnPlayer) fail(`Expected turnPlayer ${expected.turnPlayer}, got ${state.turnPlayer}`);
  if (expected.phase !== undefined && state.phase !== expected.phase) fail(`Expected phase ${expected.phase}, got ${state.phase}`);
  if (expected.randomCounter !== undefined && session.state.randomCounter !== expected.randomCounter) fail(`Expected randomCounter ${expected.randomCounter}, got ${session.state.randomCounter}`);
  assertNumberListForWindow("lastDiceResults", session.state.lastDiceResults, expected.lastDiceResults, fail);
  assertNumberListForWindow("lastCoinResults", session.state.lastCoinResults, expected.lastCoinResults, fail);
  for (const [player, expectedLifePoints] of Object.entries(expected.lifePoints ?? {}) as [string, number][]) {
    const actualLifePoints = state.players[Number(player) as PlayerId]?.lifePoints;
    if (actualLifePoints !== expectedLifePoints) fail(`Expected player ${player} LP ${expectedLifePoints}, got ${actualLifePoints}`);
  }
  assertActivityCountsForWindow(state.activityCounts, expected.activityCounts, fail);
  assertPartialList("activityHistory", session.state.activityHistory, expected.activityHistory, fail);
  assertPartialList("skippedPhases", session.state.skippedPhases, expected.skippedPhases, fail);
  if (expected.phaseActivity !== undefined && session.state.phaseActivity !== expected.phaseActivity) fail(`Expected phaseActivity ${expected.phaseActivity}, got ${session.state.phaseActivity}`);
  assertPlayerNumberMapForWindow("battleDamage", session.state.battleDamage, expected.battleDamage, fail);
  if (expected.attackCostPaid !== undefined && session.state.attackCostPaid !== expected.attackCostPaid) fail(`Expected attackCostPaid ${expected.attackCostPaid}, got ${session.state.attackCostPaid}`);
  if (expected.options !== undefined && !matchesPartial(session.state.options, expected.options)) fail(`Expected options ${JSON.stringify(expected.options)}, got ${JSON.stringify(session.state.options)}`);
  if (expected.duelTypeFlags !== undefined && session.state.duelTypeFlags !== expected.duelTypeFlags) fail(`Expected duelTypeFlags ${expected.duelTypeFlags}, got ${session.state.duelTypeFlags}`);
  if (expected.globalFlags !== undefined && session.state.globalFlags !== expected.globalFlags) fail(`Expected globalFlags ${expected.globalFlags}, got ${session.state.globalFlags}`);
  if (expected.unofficialProcEnabled !== undefined && session.state.unofficialProcEnabled !== expected.unofficialProcEnabled) fail(`Expected unofficialProcEnabled ${expected.unofficialProcEnabled}, got ${session.state.unofficialProcEnabled}`);
  if (expected.shuffleCheckDisabled !== undefined && session.state.shuffleCheckDisabled !== expected.shuffleCheckDisabled) fail(`Expected shuffleCheckDisabled ${expected.shuffleCheckDisabled}, got ${session.state.shuffleCheckDisabled}`);
  assertStringListForWindow("usedCountKeys", session.state.usedCountKeys, expected.usedCountKeys, fail);
  if (expected.battleStep !== undefined && state.battleStep !== expected.battleStep) fail(`Expected battleStep ${expected.battleStep}, got ${state.battleStep}`);
  if (expected.battleWindow !== undefined && !matchesOptionalPartial(state.battleWindow, expected.battleWindow)) fail(`Expected battleWindow ${JSON.stringify(expected.battleWindow)}, got ${JSON.stringify(state.battleWindow)}`);
  if (expected.pendingBattle !== undefined && Boolean(session.state.pendingBattle) !== expected.pendingBattle) fail(`Expected pendingBattle ${expected.pendingBattle}, got ${Boolean(session.state.pendingBattle)}`);
  if (expected.currentAttack !== undefined && Boolean(session.state.currentAttack) !== expected.currentAttack) fail(`Expected currentAttack ${expected.currentAttack}, got ${Boolean(session.state.currentAttack)}`);
  if (expected.prompt !== undefined && !matchesOptionalPartial(state.prompt, expected.prompt)) fail(`Expected prompt ${JSON.stringify(expected.prompt)}, got ${JSON.stringify(state.prompt)}`);
  if (expected.triggerOrderPrompt !== undefined && !matchesOptionalPartial(queryPublicState(session).triggerOrderPrompt, expected.triggerOrderPrompt)) {
    fail(`Expected triggerOrderPrompt ${JSON.stringify(expected.triggerOrderPrompt)}, got ${JSON.stringify(queryPublicState(session).triggerOrderPrompt)}`);
  }
  assertPartialList("chainLimits", chainLimitMetadata(session.state.chainLimits), expected.chainLimits, fail);
  assertPlayerListForWindow("chainPasses", session.state.chainPasses, expected.chainPasses, fail);
  assertPlayerListForWindow("attackPasses", state.attackPasses, expected.attackPasses, fail);
  assertPlayerListForWindow("damagePasses", state.damagePasses, expected.damagePasses, fail);
  assertPartialList("chain", state.chain, expected.chain, fail);
  assertPartialList("pendingTriggers", state.pendingTriggers, expected.pendingTriggers, fail);
  assertPendingTriggerBucketExpectations(queryPublicState(session).pendingTriggerBuckets, expected.pendingTriggerBuckets, fail);
  assertPartialList("eventHistory", session.state.eventHistory, expected.eventHistory, fail);
  assertLegalActionCounts(session, expected.legalActionCounts, fail);
  assertLegalActionGroupCounts(session, expected.legalActionGroupCounts, fail);
  assertLegalActionGroupsFlattenLegalActions(session, expected, fail);
  assertLegalActionWindowStamps(session, expected, fail);
  for (const expectedLog of expected.logIncludes ?? []) {
    if (!state.log.some((entry) => entry.detail.includes(expectedLog) || entry.action.includes(expectedLog))) fail(`Expected log containing ${expectedLog}`);
  }
  const cards = state.cards;
  if (expected.legalActions?.length) assertLegalActions("Expected legal action", session, expected.legalActions, cards, fail, false);
  if (expected.legalActionGroups?.length) assertLegalActionGroups("Expected legal action group", session, expected.legalActionGroups, cards, fail, false);
  if (expected.absentLegalActions?.length) assertLegalActions("Expected no legal action", session, expected.absentLegalActions, cards, fail, true);
  if (expected.absentLegalActionGroups?.length) assertLegalActionGroups("Expected no legal action group", session, expected.absentLegalActionGroups, cards, fail, true);
  assertLocationExpectations(cards, expected.locations, expected.locationCounts, fail);
  assertCardExpectations(cards, expected.cards, fail);
  assertStringListForWindow("positionsChanged", state.positionsChanged, expected.positionsChanged, fail);
  assertStringListForWindow("attacksDeclared", state.attacksDeclared, expected.attacksDeclared, fail);
  assertStringListForWindow("attackCanceledUids", state.attackCanceledUids, expected.attackCanceledUids, fail);
  assertStringListForWindow("attackedTargetUids", state.attackedTargetUids, expected.attackedTargetUids, fail);
  assertBattlePairsForWindow(state.battlePairs, expected.battlePairs, fail);
  if (expected.logCount !== undefined && state.log.length !== expected.logCount) fail(`Expected log count ${expected.logCount}, got ${state.log.length}`);
  assertPartialList("log", state.log, expected.log, fail);
}

function currentWindowKind(session: DuelSession): DuelActionWindowKind | undefined {
  return queryPublicState(session).windowKind;
}

function expectationLabel(expected: ScriptedDuelWindowExpectation): string {
  const source = ` (${expected.source})`;
  const note = expected.note ? ` [${expected.note}]` : "";
  return `${source}${note}`;
}

function assertStringListForWindow(name: string, actual: string[], expected: string[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertPlayerListForWindow(name: string, actual: PlayerId[], expected: PlayerId[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNumberListForWindow(name: string, actual: number[], expected: number[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertPlayerNumberMapForWindow(name: string, actual: Record<PlayerId, number>, expected: Partial<Record<PlayerId, number>> | undefined, fail: (message: string) => void): void {
  for (const [player, expectedValue] of Object.entries(expected ?? {}) as [string, number][]) {
    const actualValue = actual[Number(player) as PlayerId] ?? 0;
    if (actualValue !== expectedValue) fail(`Expected ${name}[${player}] ${expectedValue}, got ${actualValue}`);
  }
}

function assertOptionalValueForWindow<T>(name: string, actual: T | undefined, expected: T | null | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) fail(`Expected no ${name}, got ${String(actual)}`);
    return;
  }
  if (actual !== expected) fail(`Expected ${name} ${String(expected)}, got ${String(actual)}`);
}

function assertActivityCountsForWindow(actual: Record<PlayerId, unknown>, expected: Partial<Record<PlayerId, Record<string, number>>> | undefined, fail: (message: string) => void): void {
  for (const [player, expectedCounts] of Object.entries(expected ?? {}) as [string, Record<string, number>][]) {
    const actualCounts = actual[Number(player) as PlayerId] as Record<string, number> | undefined;
    for (const [activity, expectedCount] of Object.entries(expectedCounts)) {
      const actualCount = actualCounts?.[activity] ?? 0;
      if (actualCount !== expectedCount) fail(`Expected player ${player} activity ${activity} ${expectedCount}, got ${actualCount}`);
    }
  }
}

function assertLegalActionCounts(session: DuelSession, expected: Partial<Record<PlayerId, number>> | undefined, fail: (message: string) => void): void {
  for (const [player, expectedCount] of Object.entries(expected ?? {}) as [string, number][]) {
    const actualCount = getLegalActions(session, Number(player) as PlayerId).length;
    if (actualCount !== expectedCount) fail(`Expected player ${player} legal action count ${expectedCount}, got ${actualCount}`);
  }
}

function assertLegalActionGroupCounts(session: DuelSession, expected: Partial<Record<PlayerId, number>> | undefined, fail: (message: string) => void): void {
  for (const [player, expectedCount] of Object.entries(expected ?? {}) as [string, number][]) {
    const actualCount = getGroupedDuelLegalActions(session, Number(player) as PlayerId).length;
    if (actualCount !== expectedCount) fail(`Expected player ${player} legal action group count ${expectedCount}, got ${actualCount}`);
  }
}

function assertLegalActionGroupsFlattenLegalActions(session: DuelSession, expected: ScriptedDuelWindowExpectation, fail: (message: string) => void): void {
  for (const player of expectedLegalActionPlayers(expected)) {
    assertLegalActionSurface(session, player, fail);
  }
}

function assertLegalActionWindowStamps(session: DuelSession, expected: ScriptedDuelWindowExpectation, fail: (message: string) => void): void {
  for (const player of expectedLegalActionPlayers(expected)) {
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
  }
  for (const group of getGroupedDuelLegalActions(session, player)) {
    if (group.windowId !== session.state.actionWindowId || group.windowKind !== windowKind) {
      fail(`Expected player ${player} legal action group ${group.label} to be stamped with window ${session.state.actionWindowId}/${windowKind ?? "none"}`);
    }
  }
}

function expectedLegalActionPlayers(expected: ScriptedDuelWindowExpectation): Set<PlayerId> {
  const players = new Set<PlayerId>();
  for (const player of Object.keys(expected.legalActionCounts ?? {})) players.add(Number(player) as PlayerId);
  for (const player of Object.keys(expected.legalActionGroupCounts ?? {})) players.add(Number(player) as PlayerId);
  for (const action of expected.legalActions ?? []) players.add(action.player);
  for (const action of expected.absentLegalActions ?? []) players.add(action.player);
  for (const group of expected.legalActionGroups ?? []) players.add(group.player);
  for (const group of expected.absentLegalActionGroups ?? []) players.add(group.player);
  return players;
}

function assertBattlePairsForWindow(actual: { attackerUid: string; targetUid: string }[], expected: { attackerUid: string; targetUid: string }[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length || actual.some((pair, index) => pair.attackerUid !== expected[index]?.attackerUid || pair.targetUid !== expected[index]?.targetUid)) {
    fail(`Expected battlePairs ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertLocationExpectations(
  cards: { code: string; location: DuelLocation }[],
  locations: Partial<Record<DuelLocation, string[]>> | undefined,
  locationCounts: Partial<Record<DuelLocation, Record<string, number>>> | undefined,
  fail: (message: string) => void,
): void {
  for (const [location, expectedCodes] of Object.entries(locations ?? {}) as [DuelLocation, string[]][]) {
    const actualCodes = cards.filter((card) => card.location === location).map((card) => card.code);
    for (const code of expectedCodes) {
      if (!actualCodes.includes(code)) fail(`Expected ${code} in ${location}`);
    }
  }
  for (const [location, expectedCounts] of Object.entries(locationCounts ?? {}) as [DuelLocation, Record<string, number>][]) {
    const actualCounts = countCodes(cards.filter((card) => card.location === location).map((card) => card.code));
    for (const [code, expectedCount] of Object.entries(expectedCounts)) {
      const actualCount = actualCounts.get(code) ?? 0;
      if (actualCount !== expectedCount) fail(`Expected ${expectedCount} ${code} in ${location}, got ${actualCount}`);
    }
  }
}

function assertCardExpectations(cards: { uid: string }[], expectedCards: (Partial<{ uid: string }> & { uid: string })[] | undefined, fail: (message: string) => void): void {
  for (const expectedCard of expectedCards ?? []) {
    const actualCard = cards.find((card) => card.uid === expectedCard.uid);
    if (!actualCard) {
      fail(`Expected card ${expectedCard.uid}`);
      continue;
    }
    if (!matchesPartial(actualCard, expectedCard)) fail(`Expected card ${expectedCard.uid} ${JSON.stringify(expectedCard)}, got ${JSON.stringify(actualCard)}`);
  }
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
  if (expectation.windowId !== undefined && group.windowId !== expectation.windowId) return false;
  if (expectation.windowKind !== undefined && group.windowKind !== expectation.windowKind) return false;
  if (expectation.triggerBucket !== undefined && !matchesPendingTriggerBucket(group.triggerBucket, expectation.triggerBucket)) return false;
  for (const actionExpectation of expectation.actions ?? []) {
    const matches = group.actions.filter((action) => duelActionMatchesSelector(action, actionExpectation, cards));
    const expectedCount = actionExpectation.count;
    if (expectedCount === undefined ? matches.length === 0 : matches.length !== expectedCount) return false;
  }
  return true;
}

function assertPendingTriggerBucketExpectations(
  actual: PendingTriggerBucketState[],
  expected: Array<Partial<PendingTriggerBucketState>> | undefined,
  fail: (message: string) => void,
): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length) {
    fail(`Expected pendingTriggerBuckets length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPendingTriggerBucket(actual[index], partial)) fail(`Expected pendingTriggerBuckets[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function matchesPendingTriggerBucket(actual: PendingTriggerBucketState | undefined, expected: Partial<PendingTriggerBucketState>): boolean {
  if (actual === undefined) return false;
  if (expected.triggerBucket !== undefined && actual.triggerBucket !== expected.triggerBucket) return false;
  if (expected.player !== undefined && actual.player !== expected.player) return false;
  if (expected.triggerIds !== undefined && (actual.triggerIds.length !== expected.triggerIds.length || actual.triggerIds.some((id, index) => id !== expected.triggerIds?.[index]))) return false;
  return true;
}

function resolveScriptedStep(step: ScriptedStepResponse, legal: DuelAction[], cards: { uid: string; code: string; location: DuelLocation }[]): DuelAction | undefined {
  if (isConcreteResponse(step)) {
    const action = legal.find((candidate) => sameAction(candidate, step));
    if (action) return withMatchedWindowStamp(step, action);
  }
  const selector = step as ScriptedResponseSelector;
  return selectDuelActionBySelector(legal, selector, cards);
}

function withMatchedWindowStamp(step: DuelAction, action: DuelAction): DuelAction {
  if (action.windowToken === undefined) return step;
  return { ...step, windowId: action.windowId, windowKind: action.windowKind, windowToken: action.windowToken } as DuelAction;
}

function isConcreteResponse(step: ScriptedStepResponse): step is DuelAction {
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

function matchesOptionalPartial<T extends object>(actual: T | undefined, expected: Partial<T> | null): boolean {
  if (expected === null) return actual === undefined;
  return matchesPartial(actual, expected);
}

function assertPartialList<T extends object>(name: string, actual: T[], expected: Partial<T>[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (actual.length !== expected.length) {
    fail(`Expected ${name} length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected ${name}[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => matchesPartialValue((actual as Record<string, unknown>)[key], value));
}

function matchesPartialValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesPartialValue(actual[index], value));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) => matchesPartialValue(actual[key], value));
  }
  return actual === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyFixtureEffects(
  session: DuelSession,
  effects: ScriptedFixtureEffect[],
  failures: ParityFailure[],
  fixture: string,
  effectRegistry: DuelEffectRestoreRegistry,
  chainLimitRegistry: DuelChainLimitRestoreRegistry,
): void {
  for (const effect of effects) {
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
  return {
    id: effect.id,
    sourceUid,
    registryKey,
    controller: effect.player,
    event: effect.event,
    range: effect.range,
    ...(effect.effectCode === undefined ? {} : { code: effect.effectCode }),
    ...(effect.value === undefined ? {} : { value: effect.value }),
    ...(effect.valueCardCode === undefined ? {} : { valueCardPredicate: (_ctx, card) => card.code === effect.valueCardCode }),
    ...(effect.targetRange === undefined ? {} : { targetRange: effect.targetRange }),
    ...(effect.triggerEvent === undefined ? {} : { triggerEvent: effect.triggerEvent }),
    ...(effect.triggerCode === undefined ? {} : { triggerCode: effect.triggerCode }),
    ...(effect.triggerTiming === undefined ? {} : { triggerTiming: effect.triggerTiming }),
    ...(effect.optional === undefined ? {} : { optional: effect.optional }),
    ...(effect.oncePerTurn === undefined ? {} : { oncePerTurn: effect.oncePerTurn }),
    ...(effect.property === undefined ? {} : { property: effect.property }),
    ...(effect.activationChain === undefined
      ? {}
      : { canActivate: (ctx) => effect.activationChain === "chain" ? ctx.duel.chain.length > 0 : ctx.duel.chain.length === 0 }),
    ...(effect.chainLimitOnTarget === undefined
      ? {}
      : {
          target(ctx) {
            if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, createFixtureChainLimit(effect, chainLimitRegistryKey ?? "", undefined));
            return true;
          },
        }),
    operation(ctx) {
      for (const move of effect.moveCardsOnResolve ?? []) {
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
        const moved = ctx.moveCard(card.uid, move.to, move.controller);
        applyFixturePosition(moved, move.position);
        if (move.collectEvent) {
          collectDuelTriggerEffects(ctx.duel, move.collectEvent, moved, fixtureMoveEventPayload(move));
        }
      }
      if (effect.negateAttackOnResolve) ctx.log(`Negated attack ${negateDuelAttack(ctx.duel)}`);
      if (effect.negateSummonOnResolve) ctx.log(`Negated summon ${Boolean(negateFixtureSummon(ctx.duel, effect.negateSummonOnResolve))}`);
      if (effect.logMessage) ctx.log(effect.logMessage);
    },
  };
}

function negateFixtureSummon(state: DuelSession["state"], target: NonNullable<ScriptedFixtureEffect["negateSummonOnResolve"]>) {
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
    const cards = queryPublicState(session).cards.filter((card) => {
      if (card.controller !== move.player || card.code !== move.code) return false;
      return move.from === undefined || card.location === move.from;
    });
    const card = cards[move.occurrence ?? 0];
    if (!card) {
      failures.push({ fixture, message: `Setup could not find ${move.code} for player ${move.player}` });
      return;
    }
    const moved = moveDuelCard(session.state, card.uid, move.to, move.controller);
    applyFixturePosition(moved, move.position);
    if (move.collectEvent) collectDuelTriggerEffects(session.state, move.collectEvent, moved, fixtureMoveEventPayload(move));
  }
}

function applyFixturePosition(card: Pick<DuelCardInstance, "position" | "faceUp">, position: ScriptedFixtureMove["position"]): void {
  if (!position) return;
  card.position = position;
  card.faceUp = position !== "faceDown" && position !== "faceDownDefense";
}

function fixtureMoveEventPayload(move: ScriptedFixtureMove) {
  return {
    ...(move.eventCode === undefined ? {} : { eventCode: move.eventCode }),
    ...(move.eventIsLast === undefined ? {} : { eventIsLast: move.eventIsLast }),
    ...(move.eventPlayer === undefined ? {} : { eventPlayer: move.eventPlayer }),
    ...(move.eventValue === undefined ? {} : { eventValue: move.eventValue }),
    ...(move.eventReason === undefined ? {} : { eventReason: move.eventReason }),
    ...(move.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: move.eventReasonPlayer }),
    ...(move.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: move.eventReasonCardUid }),
    ...(move.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: move.eventReasonEffectId }),
    ...(move.relatedEffectId === undefined ? {} : { relatedEffectId: move.relatedEffectId }),
    ...(move.eventChainDepth === undefined ? {} : { eventChainDepth: move.eventChainDepth }),
    ...(move.eventChainLinkId === undefined ? {} : { eventChainLinkId: move.eventChainLinkId }),
    ...(move.eventUids === undefined || move.eventUids.length === 0 ? {} : { eventUids: [...move.eventUids] }),
  };
}

function applyFixturePrompt(session: DuelSession, prompt: DuelSession["state"]["prompt"] | undefined): void {
  if (!prompt) return;
  session.state.prompt = prompt.type === "selectOption" ? { ...prompt, options: [...prompt.options] } : { ...prompt };
  session.state.waitingFor = prompt.player;
}

function sameAction(action: DuelAction, response: DuelAction): boolean {
  if (action.type !== response.type || action.player !== response.player) return false;
  if (action.windowId !== undefined && response.windowId !== undefined && action.windowId !== response.windowId) return false;
  if (action.windowKind !== undefined && response.windowKind !== undefined && action.windowKind !== response.windowKind) return false;
  if ("uid" in action && "uid" in response && action.uid !== response.uid) return false;
  if (action.type === "activateEffect" && response.type === "activateEffect" && action.effectId !== response.effectId) return false;
  if (action.type === "specialSummonProcedure" && response.type === "specialSummonProcedure" && action.effectId !== response.effectId) return false;
  if (action.type === "activateTrigger" && response.type === "activateTrigger" && (action.triggerId !== response.triggerId || action.triggerBucket !== response.triggerBucket)) return false;
  if (action.type === "declineTrigger" && response.type === "declineTrigger" && (action.triggerId !== response.triggerId || action.triggerBucket !== response.triggerBucket)) return false;
  if (action.type === "selectOption" && response.type === "selectOption" && (action.promptId !== response.promptId || action.option !== response.option)) return false;
  if (action.type === "selectYesNo" && response.type === "selectYesNo" && (action.promptId !== response.promptId || action.yes !== response.yes)) return false;
  if (action.type === "tributeSummon" && response.type === "tributeSummon" && !sameStringMembers(action.tributeUids, response.tributeUids)) return false;
  if (action.type === "tributeSet" && response.type === "tributeSet" && !sameStringMembers(action.tributeUids, response.tributeUids)) return false;
  if (action.type === "fusionSummon" && response.type === "fusionSummon" && !sameStringMembers(action.materialUids, response.materialUids)) return false;
  if (action.type === "synchroSummon" && response.type === "synchroSummon" && !sameStringMembers(action.materialUids, response.materialUids)) return false;
  if (action.type === "xyzSummon" && response.type === "xyzSummon" && !sameStringMembers(action.materialUids, response.materialUids)) return false;
  if (action.type === "linkSummon" && response.type === "linkSummon" && !sameStringMembers(action.materialUids, response.materialUids)) return false;
  if (action.type === "ritualSummon" && response.type === "ritualSummon" && !sameStringMembers(action.materialUids, response.materialUids)) return false;
  if (action.type === "pendulumSummon" && response.type === "pendulumSummon" && !isPendulumSummonSelection(action.summonUids, response.summonUids)) return false;
  if (action.type === "changePosition" && response.type === "changePosition" && action.position !== response.position) return false;
  if (action.type === "declareAttack" && response.type === "declareAttack" && action.attackerUid !== response.attackerUid) return false;
  if (action.type === "declareAttack" && response.type === "declareAttack" && action.targetUid !== response.targetUid) return false;
  if (action.type === "replayAttack" && response.type === "replayAttack" && action.attackerUid !== response.attackerUid) return false;
  if (action.type === "replayAttack" && response.type === "replayAttack" && action.targetUid !== response.targetUid) return false;
  if (action.type === "cancelAttack" && response.type === "cancelAttack" && action.attackerUid !== response.attackerUid) return false;
  if (action.type === "changePhase" && response.type === "changePhase" && action.phase !== response.phase) return false;
  return true;
}

function describeStep(step: ScriptedStepResponse): string {
  if (!isConcreteResponse(step)) return describeDuelActionSelector(step);
  const detail = [
    `type=${step.type}`,
    `player=${step.player}`,
    "windowId" in step && step.windowId !== undefined ? `windowId=${step.windowId}` : undefined,
    "code" in step && step.code ? `code=${step.code}` : undefined,
    "uid" in step && step.uid ? `uid=${step.uid}` : undefined,
    "tributeUids" in step && step.tributeUids ? `tributeUids=${step.tributeUids.join(",")}` : undefined,
    "materialUids" in step && step.materialUids ? `materialUids=${step.materialUids.join(",")}` : undefined,
    "summonUids" in step && step.summonUids ? `summonUids=${step.summonUids.join(",")}` : undefined,
    "position" in step && step.position ? `position=${step.position}` : undefined,
    "phase" in step && step.phase ? `phase=${step.phase}` : undefined,
    "attackerUid" in step && step.attackerUid ? `attackerUid=${step.attackerUid}` : undefined,
    "targetUid" in step && step.targetUid ? `targetUid=${step.targetUid}` : undefined,
    "promptId" in step && step.promptId ? `promptId=${step.promptId}` : undefined,
    "option" in step && step.option !== undefined ? `option=${step.option}` : undefined,
    "yes" in step && step.yes !== undefined ? `yes=${step.yes}` : undefined,
    "effectId" in step && step.effectId ? `effectId=${step.effectId}` : undefined,
    "triggerId" in step && step.triggerId ? `triggerId=${step.triggerId}` : undefined,
    "location" in step && step.location ? `location=${step.location}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}

function isPendulumSummonSelection(candidates: string[], selected: string[]): boolean {
  if (!selected.length || selected.length > candidates.length) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}

function describeGroupExpectation(expectation: ScriptedLegalActionGroupExpectation): string {
  const detail = [
    `player=${expectation.player}`,
    expectation.key ? `key=${expectation.key}` : undefined,
    expectation.label ? `label=${expectation.label}` : undefined,
    expectation.windowId !== undefined ? `windowId=${expectation.windowId}` : undefined,
    expectation.windowKind ? `windowKind=${expectation.windowKind}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}

function countCodes(codes: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}
