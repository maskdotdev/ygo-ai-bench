import { copyDuelActivityCounts } from "#duel/activity.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { copyBattleWindowState } from "#duel/battle-window-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { isDuelEventName } from "#duel/event-names.js";
import { assertSnapshotDeferredBattleDestroyed, copyBattleAttack, copyPendingBattle } from "#duel/snapshot-battle-state.js";
import { assertSnapshotCounterBuckets, assertSnapshotCounterRecord } from "#duel/snapshot-counters.js";
import { assertSnapshotPendingWindowConsistency } from "#duel/snapshot-window-validation.js";
import { pendingTriggerBuckets, pendingTriggerBucketsForState, setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type {
  DuelCardData,
  DuelCardInstance,
  DuelCardReader,
  DuelEffectDefinition,
  DuelEffectContext,
  ChainLimit,
  DuelPromptState,
  DuelSession,
  DuelState,
  PendingTrigger,
  PlayerId,
  PublicChainLink,
  SerializedChainLimit,
  SerializedDuel,
  SerializedDuelEffect,
  TriggerBucket,
} from "#duel/types.js";

export { queryPublicState } from "#duel/public-state.js";

export type DuelEffectRestoreFactory = (effect: DuelEffectDefinition) => DuelEffectDefinition;
export type DuelEffectRestoreRegistry = Record<string, DuelEffectRestoreFactory>;
export type DuelChainLimitRestoreFactory = (limit: ChainLimit) => ChainLimit;
export type DuelChainLimitRestoreRegistry = Record<string, DuelChainLimitRestoreFactory>;

export interface DuelRestoreOptions {
  pruneUnrestoredPendingTriggers?: boolean;
}

export function serializeDuel(session: DuelSession): SerializedDuel {
  const snapshot: SerializedDuel = {
    version: 1,
    state: {
      ...session.state,
      players: {
        0: { ...session.state.players[0] },
        1: { ...session.state.players[1] },
      },
      cards: session.state.cards.map(copyCard),
      effects: session.state.effects.flatMap(serializeEffect),
      chain: session.state.chain.map(copyPublicChainLink),
      chainLimits: session.state.chainLimits.flatMap(serializeChainLimit),
      chainPasses: [...session.state.chainPasses],
      pendingTriggers: session.state.pendingTriggers.map(copyPendingTrigger),
      pendingTriggerBuckets: pendingTriggerBucketsForState(session.state),
      eventHistory: session.state.eventHistory.map(copyEventRecord),
      usedCountKeys: [...session.state.usedCountKeys],
      flagEffects: session.state.flagEffects.map((flag) => ({ ...flag })),
      skippedPhases: session.state.skippedPhases.map((skip) => ({ ...skip })),
      activityCounts: copyDuelActivityCounts(session.state.activityCounts),
      activityHistory: session.state.activityHistory.map((record) => ({ ...record })),
      battleDamage: { ...session.state.battleDamage },
      attackCostPaid: session.state.attackCostPaid,
      attacksDeclared: [...session.state.attacksDeclared],
      attackCanceledUids: [...session.state.attackCanceledUids],
      attackedTargetUids: [...session.state.attackedTargetUids],
      battlePairs: session.state.battlePairs.map((pair) => ({ ...pair })),
      attackPasses: [...session.state.attackPasses],
      damagePasses: [...session.state.damagePasses],
      ...(session.state.battleStep === undefined ? {} : { battleStep: session.state.battleStep }),
      ...(session.state.battleWindow === undefined ? {} : { battleWindow: copyBattleWindowState(session.state.battleWindow) }),
      positionsChanged: [...session.state.positionsChanged],
      ...(session.state.currentAttack === undefined ? {} : { currentAttack: copyBattleAttack(session.state.currentAttack) }),
      ...(session.state.pendingBattle === undefined ? {} : { pendingBattle: copyPendingBattle(session.state.pendingBattle) }),
      ...(session.state.prompt === undefined ? {} : { prompt: copyPrompt(session.state.prompt) }),
      log: session.state.log.map((entry) => ({ ...entry })),
    },
  };
  assertNoSnapshotCallbacks(snapshot);
  return snapshot;
}

export function restoreDuel(
  snapshot: unknown,
  cardReader: DuelCardReader = fallbackCardReader,
  effectRegistry: DuelEffectRestoreRegistry = {},
  chainLimitRegistry: DuelChainLimitRestoreRegistry = {},
  options: DuelRestoreOptions = {},
): DuelSession {
  assertRestorableSnapshot(snapshot);
  const { pendingTriggerBuckets: _pendingTriggerBuckets, ...restorableState } = snapshot.state;
  const state: DuelState = {
    ...restorableState,
    actionWindowToken: snapshot.state.actionWindowToken ?? createActionWindowToken(),
    players: {
      0: { ...snapshot.state.players[0] },
      1: { ...snapshot.state.players[1] },
    },
    cards: snapshot.state.cards.map(copyCard),
    effects: snapshot.state.effects.flatMap((effect) => restoreEffect(effect, effectRegistry)),
    lastDiceResults: [...(snapshot.state.lastDiceResults ?? [])],
    lastCoinResults: [...(snapshot.state.lastCoinResults ?? [])],
    chain: snapshot.state.chain.map(copyChainLink),
    chainLimits: snapshot.state.chainLimits.flatMap((limit) => restoreChainLimit(limit, chainLimitRegistry)),
    chainPasses: [...snapshot.state.chainPasses],
    pendingTriggers: snapshot.state.pendingTriggers.map(copyPendingTrigger),
    eventHistory: snapshot.state.eventHistory.map(copyEventRecord),
    usedCountKeys: [...snapshot.state.usedCountKeys],
    flagEffects: snapshot.state.flagEffects.map((flag) => ({ ...flag })),
    duelTypeFlags: snapshot.state.duelTypeFlags ?? (0x2000 | 0x4000 | 0x8000 | 0x20000),
    globalFlags: snapshot.state.globalFlags ?? 0,
    unofficialProcEnabled: snapshot.state.unofficialProcEnabled ?? false,
    skippedPhases: snapshot.state.skippedPhases.map((skip) => ({ ...skip })),
    activityCounts: copyDuelActivityCounts(snapshot.state.activityCounts),
    activityHistory: (snapshot.state.activityHistory ?? []).map((record) => ({ ...record })),
    phaseActivity: snapshot.state.phaseActivity ?? false,
    battleDamage: { ...snapshot.state.battleDamage },
    attackCostPaid: snapshot.state.attackCostPaid ?? 0,
    attacksDeclared: [...snapshot.state.attacksDeclared],
    attackCanceledUids: [...(snapshot.state.attackCanceledUids ?? [])],
    attackedTargetUids: [...(snapshot.state.attackedTargetUids ?? [])],
    battlePairs: (snapshot.state.battlePairs ?? []).map((pair) => ({ ...pair })),
    attackPasses: [...snapshot.state.attackPasses],
    damagePasses: [...snapshot.state.damagePasses],
    ...(snapshot.state.battleStep === undefined ? {} : { battleStep: snapshot.state.battleStep }),
    ...(snapshot.state.battleWindow === undefined ? {} : { battleWindow: copyBattleWindowState(snapshot.state.battleWindow) }),
    positionsChanged: [...snapshot.state.positionsChanged],
    ...(snapshot.state.currentAttack === undefined ? {} : { currentAttack: copyBattleAttack(snapshot.state.currentAttack) }),
    ...(snapshot.state.pendingBattle === undefined ? {} : { pendingBattle: copyPendingBattle(snapshot.state.pendingBattle) }),
    ...(snapshot.state.prompt === undefined ? {} : { prompt: copyPrompt(snapshot.state.prompt) }),
    log: snapshot.state.log.map((entry) => ({ ...entry })),
  };
  if (options.pruneUnrestoredPendingTriggers !== false) prunePendingTriggersWithoutEffects(state);
  return { cardReader, state };
}

function assertRestorableSnapshot(snapshot: unknown): asserts snapshot is SerializedDuel {
  if (!isRecord(snapshot)) throw new Error("Malformed duel snapshot: root must be an object");
  if (snapshot.version !== 1) throw new Error(`Unsupported duel snapshot version ${String(snapshot.version)}`);
  if (!isRecord(snapshot.state)) throw new Error("Malformed duel snapshot: state must be an object");
  const state = snapshot.state as Record<string, unknown>;
  const arrayFields = [
    "cards",
    "effects",
    "chain",
    "chainLimits",
    "chainPasses",
    "lastDiceResults",
    "lastCoinResults",
    "pendingTriggers",
    "eventHistory",
    "usedCountKeys",
    "flagEffects",
    "skippedPhases",
    "activityHistory",
    "attacksDeclared",
    "attackCanceledUids",
    "attackedTargetUids",
    "battlePairs",
    "attackPasses",
    "damagePasses",
    "log",
    "positionsChanged",
  ];
  for (const field of arrayFields) {
    if (!Array.isArray(state[field])) throw new Error(`Malformed duel snapshot: state.${field} must be an array`);
  }
  for (const field of ["players", "activityCounts", "battleDamage", "options"] as const) {
    if (!isRecord(state[field])) throw new Error(`Malformed duel snapshot: state.${field} must be an object`);
  }
  assertSnapshotPlayers(state.players);
  assertSnapshotOptions(state.options);
  assertSnapshotActivityCounts(state.activityCounts);
  assertSnapshotBattleDamage(state.battleDamage);
  for (const field of ["id", "seed", "status", "phase"] as const) {
    if (typeof state[field] !== "string") throw new Error(`Malformed duel snapshot: state.${field} must be a string`);
  }
  if (state.actionWindowToken !== undefined && typeof state.actionWindowToken !== "string") throw new Error("Malformed duel snapshot: state.actionWindowToken must be a string");
  for (const field of ["actionWindowId", "turn", "randomCounter"] as const) {
    assertSnapshotNonNegativeInteger(state[field], `state.${field}`);
  }
  for (const field of ["duelTypeFlags", "globalFlags", "attackCostPaid"] as const) {
    if (typeof state[field] !== "number") throw new Error(`Malformed duel snapshot: state.${field} must be a number`);
  }
  if (state.turnPlayer !== 0 && state.turnPlayer !== 1) throw new Error("Malformed duel snapshot: state.turnPlayer must be a player id");
  for (const field of ["unofficialProcEnabled", "shuffleCheckDisabled", "phaseActivity"] as const) {
    if (typeof state[field] !== "boolean") throw new Error(`Malformed duel snapshot: state.${field} must be a boolean`);
  }
  for (const field of ["chainPasses", "attackPasses", "damagePasses"] as const) {
    assertSnapshotPlayerPassArray(state[field], `state.${field}`);
  }
  assertSnapshotDiceResults(state.lastDiceResults);
  assertSnapshotCoinResults(state.lastCoinResults);
  for (const field of ["usedCountKeys", "attacksDeclared", "attackCanceledUids", "attackedTargetUids", "positionsChanged"] as const) {
    assertSnapshotStringArray(state[field], `state.${field}`);
  }
  for (const field of ["usedCountKeys", "attacksDeclared", "attackCanceledUids", "attackedTargetUids", "positionsChanged"] as const) {
    assertSnapshotUniqueStringArray(state[field], `state.${field}`);
  }
  assertSnapshotChainLimits(state.chainLimits);
  assertSnapshotSkippedPhases(state.skippedPhases);
  assertSnapshotLog(state.log);
  const cardUids = assertSnapshotCards(state.cards);
  assertSnapshotActivityHistory(state.activityHistory, cardUids);
  assertSnapshotFlagEffects(state.flagEffects, cardUids);
  for (const field of ["attacksDeclared", "attackCanceledUids", "attackedTargetUids", "positionsChanged"] as const) {
    assertSnapshotCardUidArray(state[field], `state.${field}`, cardUids);
  }
  assertSnapshotPendingTriggers(state.pendingTriggers, cardUids, state.turnPlayer);
  if (state.pendingTriggerBuckets !== undefined) assertSnapshotPendingTriggerBuckets(state.pendingTriggerBuckets, state.pendingTriggers);
  assertSnapshotEventHistory(state.eventHistory, cardUids);
  assertSnapshotBattlePairs(state.battlePairs, cardUids);
  assertSnapshotChain(state.chain, cardUids);
  assertSnapshotEffects(state.effects, cardUids);
  if (!duelSnapshotStatuses.has(state.status)) throw new Error("Malformed duel snapshot: state.status must be a duel status");
  if (!duelSnapshotPhases.has(state.phase)) throw new Error("Malformed duel snapshot: state.phase must be a duel phase");
  if (state.winner !== undefined && state.winner !== "draw") assertSnapshotPlayerId(state.winner, "state.winner");
  if (state.winReason !== undefined && typeof state.winReason !== "number") throw new Error("Malformed duel snapshot: state.winReason must be a number");
  if (state.waitingFor !== undefined) assertSnapshotPlayerId(state.waitingFor, "state.waitingFor");
  if (state.battleStep !== undefined && !duelSnapshotBattleSteps.has(state.battleStep)) throw new Error("Malformed duel snapshot: state.battleStep must be a battle step");
  if (state.prompt !== undefined) assertSnapshotPrompt(state.prompt);
  if (state.battleWindow !== undefined) assertSnapshotBattleWindow(state.battleWindow, cardUids);
  if (state.currentAttack !== undefined) assertSnapshotBattle(state.currentAttack, "state.currentAttack", cardUids);
  if (state.pendingBattle !== undefined) assertSnapshotBattle(state.pendingBattle, "state.pendingBattle", cardUids);
  assertSnapshotPendingWindowConsistency(state);
}

const duelSnapshotStatuses = new Set<unknown>(["setup", "awaiting", "resolving", "ended"]);
const duelSnapshotPhases = new Set<unknown>(["draw", "standby", "main1", "battle", "main2", "end"]);
const duelSnapshotBattleSteps = new Set<unknown>(["attack", "damage", "damageCalculation"]);
const duelSnapshotBattleWindowKinds = new Set<unknown>([
  "attackDeclaration",
  "attackTargetConfirmation",
  "attackNegationResponse",
  "replayDecision",
  "startDamageStep",
  "beforeDamageCalculation",
  "duringDamageCalculation",
  "afterDamageCalculation",
  "endDamageStep",
]);
const duelSnapshotTriggerBuckets = new Set<unknown>(["turnMandatory", "opponentMandatory", "turnOptional", "opponentOptional"]);
const duelSnapshotCardKinds = new Set<unknown>(["monster", "spell", "trap", "extra"]);
const duelSnapshotLocations = new Set<unknown>(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]);
const duelSnapshotPositions = new Set<unknown>(["faceDownDefense", "faceUpAttack", "faceUpDefense", "faceDown"]);
const duelSnapshotSummonTypes = new Set<unknown>(["normal", "tribute", "flip", "special", "fusion", "synchro", "xyz", "link", "ritual", "pendulum"]);
const duelSnapshotEffectEvents = new Set<unknown>(["ignition", "trigger", "quick", "continuous", "summonProcedure"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertSnapshotPlayerId(value: unknown, path: string): asserts value is PlayerId {
  if (value !== 0 && value !== 1) throw new Error(`Malformed duel snapshot: ${path} must be a player id`);
}

function assertSnapshotPlayerIdArray(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) assertSnapshotPlayerId(value, `${path}.${index}`);
}

function assertSnapshotPlayerPassArray(values: unknown, path: string): void {
  assertSnapshotPlayerIdArray(values, path);
  if (new Set(values as PlayerId[]).size !== (values as PlayerId[]).length) throw new Error(`Malformed duel snapshot: ${path} must not contain duplicate players`);
}

function assertSnapshotNumberArray(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) {
    if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path}.${index} must be a number`);
  }
}

function assertSnapshotDiceResults(values: unknown): void {
  assertSnapshotNumberArray(values, "state.lastDiceResults");
  for (const [index, value] of (values as number[]).entries()) {
    if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error(`Malformed duel snapshot: state.lastDiceResults.${index} must be a die result`);
  }
}

function assertSnapshotCoinResults(values: unknown): void {
  assertSnapshotNumberArray(values, "state.lastCoinResults");
  for (const [index, value] of (values as number[]).entries()) {
    if (value !== 0 && value !== 1) throw new Error(`Malformed duel snapshot: state.lastCoinResults.${index} must be a coin result`);
  }
}

function assertSnapshotStringArray(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") throw new Error(`Malformed duel snapshot: ${path}.${index} must be a string`);
  }
}

function assertSnapshotUniqueStringArray(values: unknown, path: string): void {
  if (new Set(values as string[]).size !== (values as string[]).length) throw new Error(`Malformed duel snapshot: ${path} must not contain duplicates`);
}

function assertSnapshotCardUidArray(values: unknown, path: string, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) {
    if (!cardUids.has(value as string)) throw new Error(`Malformed duel snapshot: ${path}.${index} must reference a card`);
  }
}

function assertSnapshotBattlePairs(pairs: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(pairs)) throw new Error("Malformed duel snapshot: state.battlePairs must be an array");
  const seen = new Set<string>();
  for (const [index, pair] of pairs.entries()) {
    const path = `state.battlePairs.${index}`;
    if (!isRecord(pair)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (typeof pair.attackerUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.attackerUid must be a string`);
    if (typeof pair.targetUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.targetUid must be a string`);
    if (!cardUids.has(pair.attackerUid)) throw new Error(`Malformed duel snapshot: ${path}.attackerUid must reference a card`);
    if (!cardUids.has(pair.targetUid)) throw new Error(`Malformed duel snapshot: ${path}.targetUid must reference a card`);
    const key = `${pair.attackerUid}:${pair.targetUid}`;
    if (seen.has(key)) throw new Error(`Malformed duel snapshot: ${path} must be unique by attacker and target`);
    seen.add(key);
  }
}

function assertSnapshotPendingTriggers(triggers: unknown, cardUids: ReadonlySet<string>, turnPlayer: PlayerId): void {
  if (!Array.isArray(triggers)) throw new Error("Malformed duel snapshot: state.pendingTriggers must be an array");
  const seenIds = new Set<string>();
  for (const [index, trigger] of triggers.entries()) {
    const path = `state.pendingTriggers.${index}`;
    if (!isRecord(trigger)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const field of ["id", "sourceUid", "effectId", "eventName"] as const) {
      if (typeof trigger[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (!isDuelEventName(trigger.eventName)) throw new Error(`Malformed duel snapshot: ${path}.eventName must be a duel event`);
    const id = trigger.id as string;
    if (seenIds.has(id)) throw new Error(`Malformed duel snapshot: ${path}.id must be unique`);
    seenIds.add(id);
    assertSnapshotPlayerId(trigger.player, `${path}.player`);
    if (!duelSnapshotTriggerBuckets.has(trigger.triggerBucket)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must be a trigger bucket`);
    if (!snapshotTriggerBucketMatchesPlayer(trigger.triggerBucket as TriggerBucket, trigger.player as PlayerId, turnPlayer)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must match the trigger player`);
    assertSnapshotEventPayload(trigger, path, cardUids);
    if (!cardUids.has(trigger.sourceUid as string)) throw new Error(`Malformed duel snapshot: ${path}.sourceUid must reference a card`);
    if (trigger.effectLabelObjectUid !== undefined && typeof trigger.effectLabelObjectUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.effectLabelObjectUid must be a string`);
    if (trigger.effectLabelObjectUid !== undefined && !cardUids.has(trigger.effectLabelObjectUid)) throw new Error(`Malformed duel snapshot: ${path}.effectLabelObjectUid must reference a card`);
    if (trigger.effectLabelObjectUids !== undefined) { assertSnapshotStringArray(trigger.effectLabelObjectUids, `${path}.effectLabelObjectUids`); assertSnapshotUniqueStringArray(trigger.effectLabelObjectUids, `${path}.effectLabelObjectUids`); assertSnapshotCardUidArray(trigger.effectLabelObjectUids, `${path}.effectLabelObjectUids`, cardUids); }
  }
}

function snapshotTriggerBucketMatchesPlayer(bucket: TriggerBucket, player: PlayerId, turnPlayer: PlayerId): boolean {
  const turnBucket = bucket === "turnMandatory" || bucket === "turnOptional";
  return turnBucket ? player === turnPlayer : player !== turnPlayer;
}

function assertSnapshotPendingTriggerBuckets(buckets: unknown, triggers: unknown): void {
  if (!Array.isArray(buckets)) throw new Error("Malformed duel snapshot: state.pendingTriggerBuckets must be an array");
  if (!Array.isArray(triggers)) throw new Error("Malformed duel snapshot: state.pendingTriggers must be an array");
  const triggerIds = new Set(triggers.filter(isRecord).map((trigger) => trigger.id).filter((id): id is string => typeof id === "string"));
  for (const [index, bucket] of buckets.entries()) {
    const path = `state.pendingTriggerBuckets.${index}`;
    if (!isRecord(bucket)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (!duelSnapshotTriggerBuckets.has(bucket.triggerBucket)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must be a trigger bucket`);
    assertSnapshotPlayerId(bucket.player, `${path}.player`);
    if (!Array.isArray(bucket.triggerIds)) throw new Error(`Malformed duel snapshot: ${path}.triggerIds must be an array`);
    for (const [triggerIndex, triggerId] of bucket.triggerIds.entries()) {
      if (typeof triggerId !== "string" || !triggerIds.has(triggerId)) throw new Error(`Malformed duel snapshot: ${path}.triggerIds.${triggerIndex} must reference a pending trigger`);
    }
  }
  const expected = pendingTriggerBuckets(triggers as PendingTrigger[]);
  if (JSON.stringify(buckets) !== JSON.stringify(expected)) throw new Error("Malformed duel snapshot: state.pendingTriggerBuckets must match pendingTriggers");
}

function assertSnapshotEventHistory(events: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(events)) throw new Error("Malformed duel snapshot: state.eventHistory must be an array");
  for (const [index, event] of events.entries()) {
    const path = `state.eventHistory.${index}`;
    if (!isRecord(event)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (typeof event.eventName !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventName must be a string`);
    if (!isDuelEventName(event.eventName)) throw new Error(`Malformed duel snapshot: ${path}.eventName must be a duel event`);
    assertSnapshotEventPayload(event, path, cardUids);
  }
}

function assertSnapshotEventPayload(payload: Record<string, unknown>, path: string, cardUids: ReadonlySet<string>): void {
  for (const field of ["eventCode", "eventValue", "eventReason", "eventReasonEffectId", "relatedEffectId"] as const) {
    if (payload[field] !== undefined && typeof payload[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
  if (payload.eventChainDepth !== undefined) assertSnapshotNonNegativeInteger(payload.eventChainDepth, `${path}.eventChainDepth`);
  if (payload.eventChainLinkId !== undefined && typeof payload.eventChainLinkId !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventChainLinkId must be a string`);
  for (const field of ["eventPlayer", "eventReasonPlayer"] as const) {
    if (payload[field] !== undefined) assertSnapshotPlayerId(payload[field], `${path}.${field}`);
  }
  if (payload.eventTriggerTiming !== undefined && payload.eventTriggerTiming !== "if" && payload.eventTriggerTiming !== "when") throw new Error(`Malformed duel snapshot: ${path}.eventTriggerTiming must be trigger timing`);
  if (payload.eventCardUid !== undefined && typeof payload.eventCardUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventCardUid must be a string`);
  if (payload.eventCardUid !== undefined && !cardUids.has(payload.eventCardUid)) throw new Error(`Malformed duel snapshot: ${path}.eventCardUid must reference a card`);
  if (payload.eventReasonCardUid !== undefined && typeof payload.eventReasonCardUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventReasonCardUid must be a string`);
  if (payload.eventReasonCardUid !== undefined && !cardUids.has(payload.eventReasonCardUid)) throw new Error(`Malformed duel snapshot: ${path}.eventReasonCardUid must reference a card`);
  if (payload.eventUids !== undefined) {
    if (!Array.isArray(payload.eventUids)) throw new Error(`Malformed duel snapshot: ${path}.eventUids must be an array`);
    assertSnapshotUniqueStringArray(payload.eventUids, `${path}.eventUids`);
    for (const [index, uid] of payload.eventUids.entries()) if (typeof uid !== "string" || !cardUids.has(uid)) throw new Error(`Malformed duel snapshot: ${path}.eventUids.${index} must reference a card`);
  }
  if (payload.eventPreviousState !== undefined) assertSnapshotEventCardState(payload.eventPreviousState, `${path}.eventPreviousState`);
  if (payload.eventCurrentState !== undefined) assertSnapshotEventCardState(payload.eventCurrentState, `${path}.eventCurrentState`);
}

function assertSnapshotEventCardState(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  assertSnapshotPlayerId(value.controller, `${path}.controller`);
  if (!duelSnapshotLocations.has(value.location)) throw new Error(`Malformed duel snapshot: ${path}.location must be a location`);
  assertSnapshotNonNegativeInteger(value.sequence, `${path}.sequence`);
  if (!duelSnapshotPositions.has(value.position)) throw new Error(`Malformed duel snapshot: ${path}.position must be a card position`);
  if (typeof value.faceUp !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.faceUp must be a boolean`);
}

function assertSnapshotChain(chain: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(chain)) throw new Error("Malformed duel snapshot: state.chain must be an array");
  const seenIds = new Set<string>();
  for (const [index, link] of chain.entries()) {
    const path = `state.chain.${index}`;
    if (!isRecord(link)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const field of ["id", "sourceUid", "effectId"] as const) {
      if (typeof link[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (seenIds.has(link.id as string)) throw new Error(`Malformed duel snapshot: ${path}.id must be unique`); else seenIds.add(link.id as string);
    if (!cardUids.has(link.sourceUid as string)) throw new Error(`Malformed duel snapshot: ${path}.sourceUid must reference a card`);
    assertSnapshotPlayerId(link.player, `${path}.player`);
    if (link.activationLocation !== undefined && !duelSnapshotLocations.has(link.activationLocation)) throw new Error(`Malformed duel snapshot: ${path}.activationLocation must be a card location`);
    for (const field of ["chainIndex", "activationSequence", "targetParam", "disableReason", "effectLabel"] as const) {
      if (link[field] !== undefined && typeof link[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
    }
    if (link.effectLabelObjectUid !== undefined && typeof link.effectLabelObjectUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.effectLabelObjectUid must be a string`);
    if (link.effectLabelObjectUid !== undefined && !cardUids.has(link.effectLabelObjectUid)) throw new Error(`Malformed duel snapshot: ${path}.effectLabelObjectUid must reference a card`);
    if (link.effectLabelObjectUids !== undefined) { assertSnapshotStringArray(link.effectLabelObjectUids, `${path}.effectLabelObjectUids`); assertSnapshotUniqueStringArray(link.effectLabelObjectUids, `${path}.effectLabelObjectUids`); assertSnapshotCardUidArray(link.effectLabelObjectUids, `${path}.effectLabelObjectUids`, cardUids); }
    if (link.targetUids !== undefined) {
      assertSnapshotStringArray(link.targetUids, `${path}.targetUids`);
      assertSnapshotUniqueStringArray(link.targetUids, `${path}.targetUids`);
      for (const [targetIndex, uid] of (link.targetUids as string[]).entries()) if (!cardUids.has(uid)) throw new Error(`Malformed duel snapshot: ${path}.targetUids.${targetIndex} must reference a card`);
    }
    if (link.operationInfos !== undefined) assertSnapshotOperationInfos(link.operationInfos, `${path}.operationInfos`, cardUids); if (link.possibleOperationInfos !== undefined) assertSnapshotOperationInfos(link.possibleOperationInfos, `${path}.possibleOperationInfos`, cardUids);
    if (link.targetPlayer !== undefined) assertSnapshotPlayerId(link.targetPlayer, `${path}.targetPlayer`);
    if (link.disablePlayer !== undefined) assertSnapshotPlayerId(link.disablePlayer, `${path}.disablePlayer`);
    if (link.negated !== undefined && typeof link.negated !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.negated must be a boolean`);
    assertSnapshotEventPayload(link, path, cardUids);
  }
}

function assertSnapshotOperationInfos(value: unknown, path: string, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(value)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, info] of value.entries()) {
    const infoPath = `${path}.${index}`;
    if (!isRecord(info)) throw new Error(`Malformed duel snapshot: ${infoPath} must be an object`);
    for (const field of ["category", "count", "parameter"] as const) if (typeof info[field] !== "number") throw new Error(`Malformed duel snapshot: ${infoPath}.${field} must be a number`);
    assertSnapshotPlayerId(info.player, `${infoPath}.player`);
    assertSnapshotStringArray(info.targetUids, `${infoPath}.targetUids`); assertSnapshotUniqueStringArray(info.targetUids, `${infoPath}.targetUids`);
    for (const [targetIndex, uid] of (info.targetUids as string[]).entries()) if (!cardUids.has(uid)) throw new Error(`Malformed duel snapshot: ${infoPath}.targetUids.${targetIndex} must reference a card`);
  }
}

function assertSnapshotChainLimits(limits: unknown): void {
  if (!Array.isArray(limits)) throw new Error("Malformed duel snapshot: state.chainLimits must be an array");
  for (const [index, limit] of limits.entries()) {
    const path = `state.chainLimits.${index}`;
    if (!isRecord(limit)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (limit.registryKey !== undefined && typeof limit.registryKey !== "string") throw new Error(`Malformed duel snapshot: ${path}.registryKey must be a string`);
    if (limit.expiresAtChainLength !== undefined) assertSnapshotNonNegativeInteger(limit.expiresAtChainLength, `${path}.expiresAtChainLength`); if (typeof limit.untilChainEnd !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.untilChainEnd must be a boolean`);
    if (limit.untilChainEnd === true && limit.expiresAtChainLength !== undefined) throw new Error(`Malformed duel snapshot: ${path}.expiresAtChainLength must not be set for until-chain-end limits`); if (limit.untilChainEnd === false && limit.expiresAtChainLength === undefined) throw new Error(`Malformed duel snapshot: ${path}.expiresAtChainLength is required for non-until-chain-end limits`);
  }
}

function assertSnapshotSkippedPhases(skips: unknown): void {
  if (!Array.isArray(skips)) throw new Error("Malformed duel snapshot: state.skippedPhases must be an array");
  const seen = new Set<string>();
  for (const [index, skip] of skips.entries()) {
    const path = `state.skippedPhases.${index}`;
    if (!isRecord(skip)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    assertSnapshotPlayerId(skip.player, `${path}.player`);
    if (!duelSnapshotPhases.has(skip.phase)) throw new Error(`Malformed duel snapshot: ${path}.phase must be a duel phase`);
    if (typeof skip.remaining !== "number") throw new Error(`Malformed duel snapshot: ${path}.remaining must be a number`);
    if (skip.remaining <= 0) throw new Error(`Malformed duel snapshot: ${path}.remaining must be positive`);
    const key = `${skip.player}:${skip.phase}`;
    if (seen.has(key)) throw new Error(`Malformed duel snapshot: ${path} must be unique by player and phase`);
    seen.add(key);
  }
}

function assertSnapshotActivityHistory(records: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(records)) throw new Error("Malformed duel snapshot: state.activityHistory must be an array");
  for (const [index, record] of records.entries()) {
    const path = `state.activityHistory.${index}`;
    if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    assertSnapshotPlayerId(record.player, `${path}.player`);
    if (typeof record.activity !== "number") throw new Error(`Malformed duel snapshot: ${path}.activity must be a number`);
    if (record.cardUid !== undefined) { if (typeof record.cardUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.cardUid must be a string`); if (!cardUids.has(record.cardUid)) throw new Error(`Malformed duel snapshot: ${path}.cardUid must reference a card`); }
    if (record.effectId !== undefined && typeof record.effectId !== "string") throw new Error(`Malformed duel snapshot: ${path}.effectId must be a string`);
  }
}

function assertSnapshotFlagEffects(flags: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(flags)) throw new Error("Malformed duel snapshot: state.flagEffects must be an array");
  for (const [index, flag] of flags.entries()) {
    const path = `state.flagEffects.${index}`;
    if (!isRecord(flag)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (flag.ownerType !== "player" && flag.ownerType !== "card") throw new Error(`Malformed duel snapshot: ${path}.ownerType must be a flag owner type`);
    if (typeof flag.ownerId !== "string") throw new Error(`Malformed duel snapshot: ${path}.ownerId must be a string`);
    if (flag.ownerType === "player" && flag.ownerId !== "0" && flag.ownerId !== "1") throw new Error(`Malformed duel snapshot: ${path}.ownerId must be a player id`);
    if (flag.ownerType === "card" && !cardUids.has(flag.ownerId)) throw new Error(`Malformed duel snapshot: ${path}.ownerId must reference a card`);
    for (const field of ["code", "reset", "property", "value"] as const) {
      if (typeof flag[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
    }
    assertSnapshotNonNegativeInteger(flag.turn, `${path}.turn`);
    if (flag.resetCount !== undefined) assertSnapshotNonNegativeInteger(flag.resetCount, `${path}.resetCount`);
  }
}

function assertSnapshotLog(log: unknown): void {
  if (!Array.isArray(log)) throw new Error("Malformed duel snapshot: state.log must be an array");
  for (const [index, entry] of log.entries()) {
    const path = `state.log.${index}`;
    if (!isRecord(entry)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    assertSnapshotPositiveInteger(entry.step, `${path}.step`);
    for (const field of ["action", "detail"] as const) {
      if (typeof entry[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (entry.player !== undefined) assertSnapshotPlayerId(entry.player, `${path}.player`);
    if (entry.card !== undefined && typeof entry.card !== "string") throw new Error(`Malformed duel snapshot: ${path}.card must be a string`);
  }
}

function assertSnapshotCards(cards: unknown): Set<string> {
  if (!Array.isArray(cards)) throw new Error("Malformed duel snapshot: state.cards must be an array");
  const seenUids = new Set<string>();
  const locationsByUid = new Map<string, unknown>();
  for (const [index, card] of cards.entries()) {
    const path = `state.cards.${index}`;
    if (!isRecord(card)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const field of ["uid", "code", "name"] as const) {
      if (typeof card[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    const uid = card.uid as string;
    if (seenUids.has(uid)) throw new Error(`Malformed duel snapshot: ${path}.uid must be unique`);
    seenUids.add(uid);
    locationsByUid.set(uid, card.location);
    if (!duelSnapshotCardKinds.has(card.kind)) throw new Error(`Malformed duel snapshot: ${path}.kind must be a card kind`);
    assertSnapshotPlayerId(card.owner, `${path}.owner`);
    assertSnapshotPlayerId(card.controller, `${path}.controller`);
    if (!duelSnapshotLocations.has(card.location)) throw new Error(`Malformed duel snapshot: ${path}.location must be a card location`);
    assertSnapshotNonNegativeInteger(card.sequence, `${path}.sequence`);
    if (!duelSnapshotPositions.has(card.position)) throw new Error(`Malformed duel snapshot: ${path}.position must be a card position`);
    if (!Array.isArray(card.overlayUids)) throw new Error(`Malformed duel snapshot: ${path}.overlayUids must be an array`);
    assertSnapshotStringArray(card.overlayUids, `${path}.overlayUids`);
    assertSnapshotUniqueStringArray(card.overlayUids, `${path}.overlayUids`);
    if (typeof card.faceUp !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.faceUp must be a boolean`);
    assertSnapshotOptionalCardState(card, path);
    assertSnapshotCardData(card.data, `${path}.data`);
  }
  for (const [index, card] of cards.entries()) {
    const overlayUids = (card as { overlayUids: string[] }).overlayUids;
    for (const [overlayIndex, uid] of overlayUids.entries()) {
      if (!locationsByUid.has(uid)) throw new Error(`Malformed duel snapshot: state.cards.${index}.overlayUids.${overlayIndex} must reference a card`);
      if (locationsByUid.get(uid) !== "overlay") throw new Error(`Malformed duel snapshot: state.cards.${index}.overlayUids.${overlayIndex} must reference an overlay card`);
    }
    assertSnapshotCardReferences(card as Record<string, unknown>, `state.cards.${index}`, locationsByUid);
  }
  return seenUids;
}
function assertSnapshotCardReferences(card: Record<string, unknown>, path: string, locationsByUid: ReadonlyMap<string, unknown>): void {
  for (const field of ["equippedToUid", "previousEquippedToUid", "reasonCardUid"] as const) {
    const uid = card[field];
    if (uid !== undefined && !locationsByUid.has(uid as string)) throw new Error(`Malformed duel snapshot: ${path}.${field} must reference a card`);
  }
  for (const field of ["cardTargetUids", "summonMaterialUids"] as const) {
    const uids = card[field];
    if (uids === undefined) continue;
    for (const [index, uid] of (uids as string[]).entries()) {
      if (!locationsByUid.has(uid)) throw new Error(`Malformed duel snapshot: ${path}.${field}.${index} must reference a card`);
    }
  }
}
function assertSnapshotEffects(effects: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(effects)) throw new Error("Malformed duel snapshot: state.effects must be an array");
  for (const [index, effect] of effects.entries()) {
    const path = `state.effects.${index}`;
    if (!isRecord(effect)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const field of ["id", "sourceUid"] as const) {
      if (typeof effect[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (!cardUids.has(effect.sourceUid as string)) throw new Error(`Malformed duel snapshot: ${path}.sourceUid must reference a card`);
    assertSnapshotPlayerId(effect.controller, `${path}.controller`);
    if (effect.ownerPlayer !== undefined) assertSnapshotPlayerId(effect.ownerPlayer, `${path}.ownerPlayer`);
    if (effect.registryKey !== undefined && typeof effect.registryKey !== "string") throw new Error(`Malformed duel snapshot: ${path}.registryKey must be a string`);
    if (!duelSnapshotEffectEvents.has(effect.event)) throw new Error(`Malformed duel snapshot: ${path}.event must be an effect event`);
    if (!Array.isArray(effect.range)) throw new Error(`Malformed duel snapshot: ${path}.range must be an array`);
    for (const [rangeIndex, location] of effect.range.entries()) {
      if (!duelSnapshotLocations.has(location)) throw new Error(`Malformed duel snapshot: ${path}.range.${rangeIndex} must be a card location`);
    }
    for (const field of ["code", "value", "triggerCode", "countLimit", "countLimitCode", "description", "category", "property", "copyId"] as const) {
      if (effect[field] !== undefined && typeof effect[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
    }
    for (const field of ["triggerSourceOnly", "optional", "oncePerTurn"] as const) {
      if (effect[field] !== undefined && typeof effect[field] !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a boolean`);
    }
    if (effect.triggerEvent !== undefined && typeof effect.triggerEvent !== "string") throw new Error(`Malformed duel snapshot: ${path}.triggerEvent must be a string`);
    if (effect.triggerEvent !== undefined && !isDuelEventName(effect.triggerEvent)) throw new Error(`Malformed duel snapshot: ${path}.triggerEvent must be a duel event`);
    if (effect.triggerTiming !== undefined && effect.triggerTiming !== "if" && effect.triggerTiming !== "when") throw new Error(`Malformed duel snapshot: ${path}.triggerTiming must be trigger timing`);
    if (effect.reset !== undefined) assertSnapshotEffectReset(effect.reset, `${path}.reset`);
    if (effect.targetRange !== undefined) assertSnapshotNumberTuple(effect.targetRange, `${path}.targetRange`);
    if (effect.hintTiming !== undefined) assertSnapshotNumberTuple(effect.hintTiming, `${path}.hintTiming`);
  }
}

function assertSnapshotEffectReset(reset: unknown, path: string): void {
  if (!isRecord(reset)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  if (typeof reset.flags !== "number") throw new Error(`Malformed duel snapshot: ${path}.flags must be a number`);
  if (reset.count !== undefined) assertSnapshotNonNegativeInteger(reset.count, `${path}.count`);
}

function assertSnapshotNumberTuple(tuple: unknown, path: string): void {
  if (!Array.isArray(tuple)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  if (tuple.length < 1 || tuple.length > 2) throw new Error(`Malformed duel snapshot: ${path} must contain one or two numbers`);
  for (const [index, value] of tuple.entries()) {
    if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path}.${index} must be a number`);
  }
}

function assertSnapshotOptionalCardState(card: Record<string, unknown>, path: string): void {
  for (const field of ["previousLocation"] as const) {
    if (card[field] !== undefined && !duelSnapshotLocations.has(card[field])) throw new Error(`Malformed duel snapshot: ${path}.${field} must be a card location`);
  }
  if (card.previousController !== undefined) assertSnapshotPlayerId(card.previousController, `${path}.previousController`);
  if (card.reasonPlayer !== undefined) assertSnapshotPlayerId(card.reasonPlayer, `${path}.reasonPlayer`);
  if (card.summonPlayer !== undefined) assertSnapshotPlayerId(card.summonPlayer, `${path}.summonPlayer`);
  if (card.previousPosition !== undefined && !duelSnapshotPositions.has(card.previousPosition)) throw new Error(`Malformed duel snapshot: ${path}.previousPosition must be a card position`);
  if (card.battlePosition !== undefined && !duelSnapshotPositions.has(card.battlePosition)) throw new Error(`Malformed duel snapshot: ${path}.battlePosition must be a card position`);
  if (card.summonType !== undefined && !duelSnapshotSummonTypes.has(card.summonType)) throw new Error(`Malformed duel snapshot: ${path}.summonType must be a summon type`);
  if (card.summonPhase !== undefined && !duelSnapshotPhases.has(card.summonPhase)) throw new Error(`Malformed duel snapshot: ${path}.summonPhase must be a duel phase`);
  for (const field of ["fieldId", "previousSequence", "turnId", "turnCounter"] as const) {
    if (card[field] !== undefined) assertSnapshotNonNegativeInteger(card[field], `${path}.${field}`);
  }
  for (const field of ["reason", "reasonEffectId", "customStatusMask", "summonTypeCode", "attackModifier", "defenseModifier", "levelModifier", "rankModifier", "linkModifier", "scaleModifier", "previousTypeFlags", "previousAttack", "previousDefense", "previousLevel", "previousRank", "previousLink", "previousRace", "previousAttribute"] as const) {
    if (card[field] !== undefined && typeof card[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
  for (const field of ["previousFaceUp", "cancelToGrave"] as const) {
    if (card[field] !== undefined && typeof card[field] !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a boolean`);
  }
  for (const field of ["equippedToUid", "previousEquippedToUid", "reasonCardUid"] as const) {
    if (card[field] !== undefined && typeof card[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
  }
  for (const field of ["effectRelationIds"] as const) {
    if (card[field] !== undefined) assertSnapshotEffectRelationIds(card[field], `${path}.${field}`);
  }
  for (const field of ["cardTargetUids", "summonMaterialUids"] as const) {
    if (card[field] !== undefined) {
      assertSnapshotStringArray(card[field], `${path}.${field}`);
      assertSnapshotUniqueStringArray(card[field], `${path}.${field}`);
    }
  }
  if (card.previousCodes !== undefined) assertSnapshotStringArray(card.previousCodes, `${path}.previousCodes`);
  if (card.previousSetcodes !== undefined) assertSnapshotNumberArray(card.previousSetcodes, `${path}.previousSetcodes`);
  if (card.counters !== undefined) assertSnapshotCounterRecord(card.counters, `${path}.counters`);
  if (card.counterBuckets !== undefined) assertSnapshotCounterBuckets(card.counterBuckets, `${path}.counterBuckets`);
  if (card.assumedProperties !== undefined) assertSnapshotNumberRecord(card.assumedProperties, `${path}.assumedProperties`);
  if (card.uniqueOnField !== undefined) assertSnapshotUniqueOnField(card.uniqueOnField, `${path}.uniqueOnField`);
}

function assertSnapshotUniqueOnField(unique: unknown, path: string): void {
  if (!isRecord(unique)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const field of ["self", "opponent"] as const) {
    if (typeof unique[field] !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a boolean`);
  }
  for (const field of ["code", "locationMask"] as const) {
    if (typeof unique[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
}

function assertSnapshotCardData(data: unknown, path: string): void {
  if (!isRecord(data)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const field of ["code", "name"] as const) {
    if (typeof data[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
  }
  if (!duelSnapshotCardKinds.has(data.kind)) throw new Error(`Malformed duel snapshot: ${path}.kind must be a card kind`);
  for (const field of ["typeFlags", "level", "normalTributes", "normalTributeMin", "normalTributeMax", "leftScale", "rightScale", "linkMarkers", "attack", "defense", "race", "attribute", "synchroTunerMin", "synchroTunerMax", "synchroTunerLevel", "synchroTunerAttribute", "synchroTunerRace", "synchroTunerType", "synchroTunerSetcode", "synchroNonTunerMin", "synchroNonTunerMax", "synchroNonTunerAttribute", "synchroNonTunerRace", "synchroNonTunerType", "synchroNonTunerSetcode", "xyzMaterialCount", "xyzMaterialMax", "xyzMaterialRace", "xyzMaterialAttribute", "xyzMaterialType", "xyzMaterialSetcode", "xyzMaterialRank", "linkMaterialMin", "linkMaterialMax", "linkMaterialType", "linkMaterialRace", "linkMaterialAttribute", "linkMaterialSetcode", "linkMaterialSummonType", "linkMaterialLevel", "linkMaterialMinLevel"] as const) {
    if (data[field] !== undefined && typeof data[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
  if (data.alias !== undefined && typeof data.alias !== "string") throw new Error(`Malformed duel snapshot: ${path}.alias must be a string`);
  for (const field of ["setcodes", "materialSetcodes"] as const) {
    if (data[field] !== undefined) assertSnapshotNumberArray(data[field], `${path}.${field}`);
  }
  for (const field of ["fusionMaterials", "xyzMaterials", "linkMaterials", "ritualMaterials", "listedNames", "fitMonster"] as const) {
    if (data[field] !== undefined) assertSnapshotStringArray(data[field], `${path}.${field}`);
  }
  if (data.synchroMaterials === undefined) return;
  if (!isRecord(data.synchroMaterials)) throw new Error(`Malformed duel snapshot: ${path}.synchroMaterials must be an object`);
  if (typeof data.synchroMaterials.tuner !== "string") throw new Error(`Malformed duel snapshot: ${path}.synchroMaterials.tuner must be a string`);
  assertSnapshotStringArray(data.synchroMaterials.nonTuners, `${path}.synchroMaterials.nonTuners`);
}

function assertSnapshotNumberRecord(record: unknown, path: string): void {
  if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const [key, value] of Object.entries(record)) {
    if (!/^\d+$/.test(key)) throw new Error(`Malformed duel snapshot: ${path} must use numeric keys`);
    if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path}.${key} must be a number`);
  }
}

function assertSnapshotEffectRelationIds(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  const seen = new Set<number>();
  for (const [index, value] of values.entries()) {
    assertSnapshotNonNegativeInteger(value, `${path}.${index}`);
    if (seen.has(value as number)) throw new Error(`Malformed duel snapshot: ${path} must not contain duplicates`);
    seen.add(value as number);
  }
}

function assertSnapshotNonNegativeInteger(value: unknown, path: string): void {
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Malformed duel snapshot: ${path} must be a non-negative integer`);
}

function assertSnapshotPositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Malformed duel snapshot: ${path} must be a positive integer`);
}

function assertSnapshotPlayers(players: unknown): void {
  if (!isRecord(players)) throw new Error("Malformed duel snapshot: state.players must be an object");
  assertSnapshotPlayer(players[0], 0);
  assertSnapshotPlayer(players[1], 1);
}

function assertSnapshotPlayer(player: unknown, expectedId: PlayerId): void {
  const path = `state.players.${expectedId}`;
  if (!isRecord(player)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  if (player.id !== expectedId) throw new Error(`Malformed duel snapshot: ${path}.id must match the player id`);
  assertSnapshotNonNegativeInteger(player.lifePoints, `${path}.lifePoints`);
  if (typeof player.normalSummonAvailable !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.normalSummonAvailable must be a boolean`);
  if (typeof player.pendulumSummonAvailable !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.pendulumSummonAvailable must be a boolean`);
  if (player.initialMainDeckSize !== undefined) assertSnapshotNonNegativeInteger(player.initialMainDeckSize, `${path}.initialMainDeckSize`);
}

function assertSnapshotOptions(options: unknown): void {
  if (!isRecord(options)) throw new Error("Malformed duel snapshot: state.options must be an object");
  for (const field of ["startingLifePoints", "startingHandSize", "drawPerTurn"] as const) {
    assertSnapshotNonNegativeInteger(options[field], `state.options.${field}`);
  }
}

function assertSnapshotActivityCounts(counts: unknown): void {
  if (!isRecord(counts)) throw new Error("Malformed duel snapshot: state.activityCounts must be an object");
  assertSnapshotActivityCount(counts[0], "state.activityCounts.0");
  assertSnapshotActivityCount(counts[1], "state.activityCounts.1");
}

function assertSnapshotActivityCount(count: unknown, path: string): void {
  if (!isRecord(count)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const field of ["summon", "normalSummon", "specialSummon", "flipSummon", "attack"] as const) {
    assertSnapshotNonNegativeInteger(count[field], `${path}.${field}`);
  }
}

function assertSnapshotBattleDamage(battleDamage: unknown): void {
  if (!isRecord(battleDamage)) throw new Error("Malformed duel snapshot: state.battleDamage must be an object");
  for (const player of [0, 1] as const) {
    assertSnapshotNonNegativeInteger(battleDamage[player], `state.battleDamage.${player}`);
  }
}

function assertSnapshotPrompt(prompt: unknown): asserts prompt is DuelPromptState {
  if (!isRecord(prompt)) throw new Error("Malformed duel snapshot: state.prompt must be an object");
  if (typeof prompt.id !== "string") throw new Error("Malformed duel snapshot: state.prompt.id must be a string");
  assertSnapshotPlayerId(prompt.player, "state.prompt.player");
  if (prompt.returnTo !== undefined) assertSnapshotPlayerId(prompt.returnTo, "state.prompt.returnTo");
  if (prompt.type === "selectOption") {
    if (!Array.isArray(prompt.options)) throw new Error("Malformed duel snapshot: state.prompt.options must be an array");
    if (prompt.options.some((option) => typeof option !== "number")) throw new Error("Malformed duel snapshot: state.prompt.options must contain numbers");
    return;
  }
  if (prompt.type === "selectYesNo") {
    if (prompt.description !== undefined && typeof prompt.description !== "number") throw new Error("Malformed duel snapshot: state.prompt.description must be a number");
    return;
  }
  throw new Error("Malformed duel snapshot: state.prompt.type must be a prompt type");
}

function assertSnapshotBattleWindow(window: unknown, cardUids: ReadonlySet<string>): void {
  if (!isRecord(window)) throw new Error("Malformed duel snapshot: state.battleWindow must be an object");
  assertSnapshotNonNegativeInteger(window.id, "state.battleWindow.id");
  if (!duelSnapshotBattleWindowKinds.has(window.kind)) throw new Error("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
  if (!duelSnapshotBattleSteps.has(window.step)) throw new Error("Malformed duel snapshot: state.battleWindow.step must be a battle step");
  if (!snapshotBattleWindowKindMatchesStep(window.kind, window.step)) throw new Error("Malformed duel snapshot: state.battleWindow.kind must match step");
  if (typeof window.attackerUid !== "string") throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must be a string");
  if (window.targetUid !== undefined && typeof window.targetUid !== "string") throw new Error("Malformed duel snapshot: state.battleWindow.targetUid must be a string");
  if (!cardUids.has(window.attackerUid)) throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must reference a card");
  if (window.targetUid !== undefined && !cardUids.has(window.targetUid)) throw new Error("Malformed duel snapshot: state.battleWindow.targetUid must reference a card");
  assertSnapshotPlayerId(window.responsePlayer, "state.battleWindow.responsePlayer");
  if (typeof window.attackNegated !== "boolean") throw new Error("Malformed duel snapshot: state.battleWindow.attackNegated must be a boolean");
}

function snapshotBattleWindowKindMatchesStep(kind: unknown, step: unknown): boolean {
  if (kind === "duringDamageCalculation") return step === "damageCalculation";
  if (kind === "startDamageStep" || kind === "beforeDamageCalculation" || kind === "afterDamageCalculation" || kind === "endDamageStep") return step === "damage";
  return step === "attack";
}

function assertSnapshotBattle(battle: unknown, path: string, cardUids: ReadonlySet<string>): void {
  if (!isRecord(battle)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  if (typeof battle.attackerUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.attackerUid must be a string`);
  if (battle.targetUid !== undefined && typeof battle.targetUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.targetUid must be a string`);
  if (!cardUids.has(battle.attackerUid)) throw new Error(`Malformed duel snapshot: ${path}.attackerUid must reference a card`);
  if (battle.targetUid !== undefined && !cardUids.has(battle.targetUid)) throw new Error(`Malformed duel snapshot: ${path}.targetUid must reference a card`);
  if (battle.replayTargetCount !== undefined) assertSnapshotNonNegativeInteger(battle.replayTargetCount, `${path}.replayTargetCount`);
  if (battle.replayTargetUids !== undefined) {
    assertSnapshotStringArray(battle.replayTargetUids, `${path}.replayTargetUids`);
    assertSnapshotUniqueStringArray(battle.replayTargetUids, `${path}.replayTargetUids`);
    assertSnapshotCardUidArray(battle.replayTargetUids, `${path}.replayTargetUids`, cardUids);
  }
  if (battle.resultApplied !== undefined && typeof battle.resultApplied !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.resultApplied must be a boolean`);
  if (battle.battleDamageOverrides !== undefined) assertSnapshotBattleDamageOverrides(battle.battleDamageOverrides, `${path}.battleDamageOverrides`);
  if (battle.deferredBattleDestroyed !== undefined) assertSnapshotDeferredBattleDestroyed(battle.deferredBattleDestroyed, `${path}.deferredBattleDestroyed`, cardUids);
}

function assertSnapshotBattleDamageOverrides(overrides: unknown, path: string): void {
  if (!isRecord(overrides)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const [player, amount] of Object.entries(overrides)) {
    if (player !== "0" && player !== "1") throw new Error(`Malformed duel snapshot: ${path} must use player ids`);
    assertSnapshotNonNegativeInteger(amount, `${path}.${player}`);
  }
}

function serializeEffect(effect: DuelEffectDefinition): SerializedDuelEffect[] {
  if (!isStaticContinuousEffect(effect) && effect.registryKey === undefined) return [];
  if (effect.registryKey === undefined && hasUnserializableEffectCallbacks(effect)) return [];
  return [copySerializedEffect(effect)];
}

function copySerializedEffect(effect: DuelEffectDefinition): SerializedDuelEffect {
  const {
    battleDamageValue: _battleDamageValue,
    canActivate: _canActivate,
    cost: _cost,
    labelObjectUid: _labelObjectUid,
    labelObjectUids: _labelObjectUids,
    lifePointValue: _lifePointValue,
    luaTypeFlags: _luaTypeFlags,
    operation: _operation,
    statValue: _statValue,
    target: _target,
    targetCardPredicate: _targetCardPredicate,
    valueCardPredicate: _valueCardPredicate,
    valuePredicate: _valuePredicate,
    ...metadata
  } = effect;
  return {
    ...metadata,
    range: [...effect.range],
    ...(effect.reset ? { reset: { ...effect.reset } } : {}),
    ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
    ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
  };
}

function restoreEffect(effect: SerializedDuelEffect, effectRegistry: DuelEffectRestoreRegistry): DuelEffectDefinition[] {
  const restoredEffect = withNoopOperation(effect);
  if (effect.registryKey !== undefined) {
    const factory = effectRegistry[effect.registryKey];
    return factory ? [factory(restoredEffect)] : [];
  }
  if (!isStaticContinuousEffect(effect)) return [];
  return [restoredEffect];
}

function withNoopOperation(effect: SerializedDuelEffect): DuelEffectDefinition {
  return { ...effect, operation: noopEffectOperation };
}

function hasUnserializableEffectCallbacks(effect: DuelEffectDefinition): boolean {
  return effect.battleDamageValue !== undefined || effect.lifePointValue !== undefined || effect.statValue !== undefined || effect.targetCardPredicate !== undefined || effect.valueCardPredicate !== undefined || effect.valuePredicate !== undefined;
}

function serializeChainLimit(limit: ChainLimit): SerializedChainLimit[] {
  if (limit.registryKey === undefined) return [];
  return [copySerializedChainLimit(limit)];
}

function copySerializedChainLimit(limit: ChainLimit): SerializedChainLimit {
  const { allows: _allows, release: _release, ...metadata } = limit;
  return { ...metadata };
}

function restoreChainLimit(limit: SerializedChainLimit, chainLimitRegistry: DuelChainLimitRestoreRegistry): ChainLimit[] {
  if (limit.registryKey === undefined) return [];
  const factory = chainLimitRegistry[limit.registryKey];
  return factory ? [factory(withDenyChainLimit(limit))] : [];
}

function withDenyChainLimit(limit: SerializedChainLimit): ChainLimit {
  return { ...limit, allows: denyChainLimit };
}

function assertNoSnapshotCallbacks(value: unknown, path = "snapshot"): void {
  if (typeof value === "function") throw new Error(`Duel snapshot contains non-serializable callback at ${path}`);
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSnapshotCallbacks(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) assertNoSnapshotCallbacks(child, `${path}.${key}`);
}

export function prunePendingTriggersWithoutEffects(state: DuelState): void {
  const beforeCount = state.pendingTriggers.length;
  state.pendingTriggers = state.pendingTriggers.filter((trigger) => state.effects.some((effect) => effect.id === trigger.effectId && effect.sourceUid === trigger.sourceUid));
  if (state.pendingTriggers.length === beforeCount) return;
  if (state.prompt !== undefined || state.chain.length > 0) return;
  setWaitingForPendingTriggerBucket(state);
}

function isStaticContinuousEffect(effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  return effect.event === "continuous" && !("canActivate" in effect) && !("cost" in effect) && !("target" in effect);
}

function noopEffectOperation(_ctx: DuelEffectContext): void {}

function denyChainLimit(_effect: DuelEffectDefinition, _player: PlayerId, _chainPlayer: PlayerId): boolean {
  return false;
}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return {
    ...copyEventPayload(link),
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) }),
  };
}

function copyPublicChainLink(link: DuelState["chain"][number]): PublicChainLink {
  const { operationOverride: _operationOverride, ...publicLink } = link;
  return {
    ...copyEventPayload(publicLink),
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) }),
  };
}

function copyOperationInfos(infos: NonNullable<DuelState["chain"][number]["operationInfos"]>): NonNullable<DuelState["chain"][number]["operationInfos"]> {
  return infos.map((info) => ({ ...info, targetUids: [...info.targetUids] }));
}

function copyPendingTrigger(trigger: DuelState["pendingTriggers"][number]): DuelState["pendingTriggers"][number] { return copyEventPayload(trigger); }
function copyEventRecord(event: DuelState["eventHistory"][number]): DuelState["eventHistory"][number] { return copyEventPayload(event); }

function copyEventPayload<T extends DuelState["chain"][number] | PublicChainLink | DuelState["pendingTriggers"][number] | DuelState["eventHistory"][number]>(payload: T): T {
  return {
    ...payload,
    ...(payload.eventUids === undefined ? {} : { eventUids: [...payload.eventUids] }),
    ...("effectLabelObjectUids" in payload && payload.effectLabelObjectUids !== undefined ? { effectLabelObjectUids: [...payload.effectLabelObjectUids] } : {}),
    ...(payload.eventPreviousState === undefined ? {} : { eventPreviousState: { ...payload.eventPreviousState } }),
    ...(payload.eventCurrentState === undefined ? {} : { eventCurrentState: { ...payload.eventCurrentState } }),
  };
}

function copyCard(card: DuelCardInstance): DuelCardInstance {
  return {
    ...card,
    data: copyCardData(card.data),
    overlayUids: [...card.overlayUids],
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(card.counterBuckets ? { counterBuckets: copyCounterBuckets(card.counterBuckets) } : {}),
    ...(card.effectRelationIds ? { effectRelationIds: [...card.effectRelationIds] } : {}),
    ...(card.cardTargetUids ? { cardTargetUids: [...card.cardTargetUids] } : {}),
    ...(card.summonMaterialUids ? { summonMaterialUids: [...card.summonMaterialUids] } : {}),
    ...(card.previousCodes === undefined ? {} : { previousCodes: [...card.previousCodes] }),
    ...(card.previousSetcodes === undefined ? {} : { previousSetcodes: [...card.previousSetcodes] }),
    ...(card.assumedProperties ? { assumedProperties: { ...card.assumedProperties } } : {}),
    ...(card.uniqueOnField ? { uniqueOnField: { ...card.uniqueOnField } } : {}),
  };
}

function copyCounterBuckets(counterBuckets: NonNullable<DuelCardInstance["counterBuckets"]>): NonNullable<DuelCardInstance["counterBuckets"]> {
  return Object.fromEntries(Object.entries(counterBuckets).map(([counterType, buckets]) => [counterType, { ...buckets }]));
}

function copyCardData(data: DuelCardData): DuelCardData {
  return {
    ...data,
    ...(data.setcodes ? { setcodes: [...data.setcodes] } : {}),
    ...(data.fusionMaterials ? { fusionMaterials: [...data.fusionMaterials] } : {}),
    ...(data.materialSetcodes ? { materialSetcodes: [...data.materialSetcodes] } : {}),
    ...(data.synchroMaterials ? { synchroMaterials: { tuner: data.synchroMaterials.tuner, nonTuners: [...data.synchroMaterials.nonTuners] } } : {}),
    ...(data.xyzMaterials ? { xyzMaterials: [...data.xyzMaterials] } : {}),
    ...(data.linkMaterials ? { linkMaterials: [...data.linkMaterials] } : {}),
    ...(data.ritualMaterials ? { ritualMaterials: [...data.ritualMaterials] } : {}),
    ...(data.listedNames ? { listedNames: [...data.listedNames] } : {}),
    ...(data.fitMonster ? { fitMonster: [...data.fitMonster] } : {}),
  };
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options] };
  return { ...prompt };
}
