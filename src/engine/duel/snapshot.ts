import { copyDuelActivityCounts } from "#duel/activity.js";
import { copyBattleWindowState } from "#duel/battle-window-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
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
  PlayerId,
  PublicChainLink,
  PublicDuelCard,
  PublicDuelState,
  SerializedChainLimit,
  SerializedDuel,
  SerializedDuelEffect,
} from "#duel/types.js";

export type DuelEffectRestoreFactory = (effect: DuelEffectDefinition) => DuelEffectDefinition;
export type DuelEffectRestoreRegistry = Record<string, DuelEffectRestoreFactory>;
export type DuelChainLimitRestoreFactory = (limit: ChainLimit) => ChainLimit;
export type DuelChainLimitRestoreRegistry = Record<string, DuelChainLimitRestoreFactory>;

export interface DuelRestoreOptions {
  pruneUnrestoredPendingTriggers?: boolean;
}

export function queryPublicState(session: DuelSession): PublicDuelState {
  const state = session.state;
  return {
    id: state.id,
    status: state.status,
    ...(state.winner === undefined ? {} : { winner: state.winner }),
    ...(state.winReason === undefined ? {} : { winReason: state.winReason }),
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
    ...(state.prompt === undefined ? {} : { prompt: copyPrompt(state.prompt) }),
    players: {
      0: { ...state.players[0] },
      1: { ...state.players[1] },
    },
    cards: state.cards.map(toPublicCard).sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence),
    chain: state.chain.map(copyPublicChainLink),
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
    activityCounts: copyDuelActivityCounts(state.activityCounts),
    attacksDeclared: [...state.attacksDeclared],
    attackCanceledUids: [...state.attackCanceledUids],
    attackedTargetUids: [...state.attackedTargetUids],
    battlePairs: state.battlePairs.map((pair) => ({ ...pair })),
    attackPasses: [...state.attackPasses],
    damagePasses: [...state.damagePasses],
    ...(state.battleStep === undefined ? {} : { battleStep: state.battleStep }),
    ...(state.battleWindow === undefined ? {} : { battleWindow: copyBattleWindowState(state.battleWindow) }),
    positionsChanged: [...state.positionsChanged],
    log: state.log.map((entry) => ({ ...entry })),
  };
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
      pendingTriggers: session.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      eventHistory: session.state.eventHistory.map((event) => ({ ...event })),
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
      ...(session.state.currentAttack === undefined ? {} : { currentAttack: { ...session.state.currentAttack } }),
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
  const state: DuelState = {
    ...snapshot.state,
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
    pendingTriggers: snapshot.state.pendingTriggers.map((trigger) => ({ ...trigger })),
    eventHistory: snapshot.state.eventHistory.map((event) => ({ ...event })),
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
    ...(snapshot.state.currentAttack === undefined ? {} : { currentAttack: { ...snapshot.state.currentAttack } }),
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
  for (const field of ["actionWindowId", "turn", "randomCounter", "duelTypeFlags", "globalFlags", "attackCostPaid"] as const) {
    if (typeof state[field] !== "number") throw new Error(`Malformed duel snapshot: state.${field} must be a number`);
  }
  if (state.turnPlayer !== 0 && state.turnPlayer !== 1) throw new Error("Malformed duel snapshot: state.turnPlayer must be a player id");
  for (const field of ["unofficialProcEnabled", "shuffleCheckDisabled", "phaseActivity"] as const) {
    if (typeof state[field] !== "boolean") throw new Error(`Malformed duel snapshot: state.${field} must be a boolean`);
  }
  for (const field of ["chainPasses", "attackPasses", "damagePasses"] as const) {
    assertSnapshotPlayerIdArray(state[field], `state.${field}`);
  }
  for (const field of ["lastDiceResults", "lastCoinResults"] as const) {
    assertSnapshotNumberArray(state[field], `state.${field}`);
  }
  for (const field of ["usedCountKeys", "attacksDeclared", "attackCanceledUids", "attackedTargetUids", "positionsChanged"] as const) {
    assertSnapshotStringArray(state[field], `state.${field}`);
  }
  assertSnapshotBattlePairs(state.battlePairs);
  assertSnapshotPendingTriggers(state.pendingTriggers);
  assertSnapshotEventHistory(state.eventHistory);
  if (!duelSnapshotStatuses.has(state.status)) throw new Error("Malformed duel snapshot: state.status must be a duel status");
  if (!duelSnapshotPhases.has(state.phase)) throw new Error("Malformed duel snapshot: state.phase must be a duel phase");
  if (state.winner !== undefined && state.winner !== "draw") assertSnapshotPlayerId(state.winner, "state.winner");
  if (state.winReason !== undefined && typeof state.winReason !== "number") throw new Error("Malformed duel snapshot: state.winReason must be a number");
  if (state.waitingFor !== undefined) assertSnapshotPlayerId(state.waitingFor, "state.waitingFor");
  if (state.battleStep !== undefined && !duelSnapshotBattleSteps.has(state.battleStep)) throw new Error("Malformed duel snapshot: state.battleStep must be a battle step");
  if (state.prompt !== undefined) assertSnapshotPrompt(state.prompt);
  if (state.battleWindow !== undefined) assertSnapshotBattleWindow(state.battleWindow);
  if (state.currentAttack !== undefined) assertSnapshotBattle(state.currentAttack, "state.currentAttack");
  if (state.pendingBattle !== undefined) assertSnapshotBattle(state.pendingBattle, "state.pendingBattle");
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

function assertSnapshotNumberArray(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) {
    if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path}.${index} must be a number`);
  }
}

function assertSnapshotStringArray(values: unknown, path: string): void {
  if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") throw new Error(`Malformed duel snapshot: ${path}.${index} must be a string`);
  }
}

function assertSnapshotBattlePairs(pairs: unknown): void {
  if (!Array.isArray(pairs)) throw new Error("Malformed duel snapshot: state.battlePairs must be an array");
  for (const [index, pair] of pairs.entries()) {
    const path = `state.battlePairs.${index}`;
    if (!isRecord(pair)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (typeof pair.attackerUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.attackerUid must be a string`);
    if (typeof pair.targetUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.targetUid must be a string`);
  }
}

function assertSnapshotPendingTriggers(triggers: unknown): void {
  if (!Array.isArray(triggers)) throw new Error("Malformed duel snapshot: state.pendingTriggers must be an array");
  for (const [index, trigger] of triggers.entries()) {
    const path = `state.pendingTriggers.${index}`;
    if (!isRecord(trigger)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const field of ["id", "sourceUid", "effectId", "eventName"] as const) {
      if (typeof trigger[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    assertSnapshotPlayerId(trigger.player, `${path}.player`);
    if (!duelSnapshotTriggerBuckets.has(trigger.triggerBucket)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must be a trigger bucket`);
    assertSnapshotEventPayload(trigger, path);
  }
}

function assertSnapshotEventHistory(events: unknown): void {
  if (!Array.isArray(events)) throw new Error("Malformed duel snapshot: state.eventHistory must be an array");
  for (const [index, event] of events.entries()) {
    const path = `state.eventHistory.${index}`;
    if (!isRecord(event)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    if (typeof event.eventName !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventName must be a string`);
    assertSnapshotEventPayload(event, path);
  }
}

function assertSnapshotEventPayload(payload: Record<string, unknown>, path: string): void {
  for (const field of ["eventCode", "eventValue", "eventReason", "relatedEffectId"] as const) {
    if (payload[field] !== undefined && typeof payload[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
  for (const field of ["eventPlayer", "eventReasonPlayer"] as const) {
    if (payload[field] !== undefined) assertSnapshotPlayerId(payload[field], `${path}.${field}`);
  }
  if (payload.eventCardUid !== undefined && typeof payload.eventCardUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventCardUid must be a string`);
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
  if (typeof player.lifePoints !== "number") throw new Error(`Malformed duel snapshot: ${path}.lifePoints must be a number`);
  if (typeof player.normalSummonAvailable !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.normalSummonAvailable must be a boolean`);
  if (player.initialMainDeckSize !== undefined && typeof player.initialMainDeckSize !== "number") throw new Error(`Malformed duel snapshot: ${path}.initialMainDeckSize must be a number`);
}

function assertSnapshotOptions(options: unknown): void {
  if (!isRecord(options)) throw new Error("Malformed duel snapshot: state.options must be an object");
  for (const field of ["startingLifePoints", "startingHandSize", "drawPerTurn"] as const) {
    if (typeof options[field] !== "number") throw new Error(`Malformed duel snapshot: state.options.${field} must be a number`);
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
    if (typeof count[field] !== "number") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a number`);
  }
}

function assertSnapshotBattleDamage(battleDamage: unknown): void {
  if (!isRecord(battleDamage)) throw new Error("Malformed duel snapshot: state.battleDamage must be an object");
  for (const player of [0, 1] as const) {
    if (typeof battleDamage[player] !== "number") throw new Error(`Malformed duel snapshot: state.battleDamage.${player} must be a number`);
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

function assertSnapshotBattleWindow(window: unknown): void {
  if (!isRecord(window)) throw new Error("Malformed duel snapshot: state.battleWindow must be an object");
  if (typeof window.id !== "number") throw new Error("Malformed duel snapshot: state.battleWindow.id must be a number");
  if (!duelSnapshotBattleWindowKinds.has(window.kind)) throw new Error("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
  if (!duelSnapshotBattleSteps.has(window.step)) throw new Error("Malformed duel snapshot: state.battleWindow.step must be a battle step");
  if (typeof window.attackerUid !== "string") throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must be a string");
  if (window.targetUid !== undefined && typeof window.targetUid !== "string") throw new Error("Malformed duel snapshot: state.battleWindow.targetUid must be a string");
  assertSnapshotPlayerId(window.responsePlayer, "state.battleWindow.responsePlayer");
  if (typeof window.attackNegated !== "boolean") throw new Error("Malformed duel snapshot: state.battleWindow.attackNegated must be a boolean");
}

function assertSnapshotBattle(battle: unknown, path: string): void {
  if (!isRecord(battle)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  if (typeof battle.attackerUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.attackerUid must be a string`);
  if (battle.targetUid !== undefined && typeof battle.targetUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.targetUid must be a string`);
  if (battle.replayTargetCount !== undefined && typeof battle.replayTargetCount !== "number") throw new Error(`Malformed duel snapshot: ${path}.replayTargetCount must be a number`);
  if (battle.battleDamageOverrides === undefined) return;
  if (!isRecord(battle.battleDamageOverrides)) throw new Error(`Malformed duel snapshot: ${path}.battleDamageOverrides must be an object`);
  for (const [player, amount] of Object.entries(battle.battleDamageOverrides)) {
    if (player !== "0" && player !== "1") throw new Error(`Malformed duel snapshot: ${path}.battleDamageOverrides must use player ids`);
    if (typeof amount !== "number") throw new Error(`Malformed duel snapshot: ${path}.battleDamageOverrides.${player} must be a number`);
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
    operation: _operation,
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
  return effect.battleDamageValue !== undefined || effect.targetCardPredicate !== undefined || effect.valueCardPredicate !== undefined || effect.valuePredicate !== undefined;
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
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

function isStaticContinuousEffect(effect: DuelEffectDefinition | SerializedDuelEffect): boolean {
  return effect.event === "continuous" && !("canActivate" in effect) && !("cost" in effect) && !("target" in effect);
}

function noopEffectOperation(_ctx: DuelEffectContext): void {}

function denyChainLimit(_effect: DuelEffectDefinition, _player: PlayerId, _chainPlayer: PlayerId): boolean {
  return false;
}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return { ...link, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
}

function copyPublicChainLink(link: DuelState["chain"][number]): PublicChainLink {
  const { operationOverride: _operationOverride, ...publicLink } = link;
  return { ...publicLink, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
}

function copyCard(card: DuelCardInstance): DuelCardInstance {
  return {
    ...card,
    data: copyCardData(card.data),
    overlayUids: [...card.overlayUids],
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(card.effectRelationIds ? { effectRelationIds: [...card.effectRelationIds] } : {}),
    ...(card.cardTargetUids ? { cardTargetUids: [...card.cardTargetUids] } : {}),
    ...(card.summonMaterialUids ? { summonMaterialUids: [...card.summonMaterialUids] } : {}),
    ...(card.assumedProperties ? { assumedProperties: { ...card.assumedProperties } } : {}),
    ...(card.uniqueOnField ? { uniqueOnField: { ...card.uniqueOnField } } : {}),
  };
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

function copyPendingBattle(pendingBattle: NonNullable<DuelState["pendingBattle"]>): NonNullable<DuelState["pendingBattle"]> {
  return {
    ...pendingBattle,
    ...(pendingBattle.battleDamageOverrides === undefined ? {} : { battleDamageOverrides: { ...pendingBattle.battleDamageOverrides } }),
  };
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options] };
  return { ...prompt };
}

function toPublicCard(card: DuelCardInstance): PublicDuelCard {
  return {
    uid: card.uid,
    code: card.code,
    name: card.name,
    kind: card.kind,
    owner: card.owner,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
    overlayCount: card.overlayUids.length,
    ...(card.counters ? { counters: { ...card.counters } } : {}),
  };
}
