import { copyDuelActivityCounts } from "#duel/activity.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { copyBattleWindowState, isBattleWindowKind } from "#duel/battle-window-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { isCardPosition, isDuelCardKind, isDuelEffectEvent, isDuelSummonType } from "#duel/card-kinds.js";
import { isDuelEventName } from "#duel/event-names.js";
import { isDuelLocation } from "#duel/location-kinds.js";
import { isDuelPromptType } from "#duel/prompt-kinds.js";
import { assertSnapshotDeferredBattleDestroyed, copyBattleAttack, copyPendingBattle } from "#duel/snapshot-battle-state.js";
import { copyCard, copyChainLink, copyEventRecord, copyLuaOperationPromptDecision, copyPendingTrigger, copyPrompt, copyPublicChainLink } from "#duel/snapshot-copy.js";
import { assertSnapshotCounterBuckets, assertSnapshotCounterRecord } from "#duel/snapshot-counters.js";
import { assertSnapshotPendingWindowConsistency } from "#duel/snapshot-window-validation.js";
import { isBattleStep, isDuelPhase, isDuelStatus } from "#duel/state-kinds.js";
import { isTriggerBucket, pendingTriggerBuckets, pendingTriggerBucketsForState, setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import { isLuaOptionPromptApi, isLuaYesNoPromptApi } from "#lua/host-types.js";
import type {
  DuelCardReader,
  DuelEffectDefinition,
  DuelEffectContext,
  ChainLimit,
  DuelPromptState,
  DuelSession,
  DuelState,
  PendingTrigger,
  PlayerId,
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
      ...(session.state.luaOperationPrompt === undefined ? {} : { luaOperationPrompt: { chainLink: copyPublicChainLink(session.state.luaOperationPrompt.chainLink), prompt: copyLuaOperationPromptDecision(session.state.luaOperationPrompt.prompt) } }),
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
    ...(snapshot.state.luaOperationPrompt === undefined ? {} : { luaOperationPrompt: { chainLink: copyChainLink(snapshot.state.luaOperationPrompt.chainLink), prompt: copyLuaOperationPromptDecision(snapshot.state.luaOperationPrompt.prompt) } }),
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
  for (const key of Object.keys(state)) if (!duelSnapshotStateKeys.has(key)) throw new Error(`Malformed duel snapshot: state.${key} is not a known field`);
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
  if (state.actionWindowToken !== undefined && (typeof state.actionWindowToken !== "string" || state.actionWindowToken.length === 0)) throw new Error("Malformed duel snapshot: state.actionWindowToken must be a non-empty string");
  for (const field of ["actionWindowId", "turn", "randomCounter"] as const) {
    assertSnapshotSafeNonNegativeInteger(state[field], `state.${field}`);
  }
  for (const field of ["duelTypeFlags", "globalFlags", "attackCostPaid"] as const) {
    assertSnapshotNonNegativeInteger(state[field], `state.${field}`);
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
  const effectEvents = assertSnapshotEffects(state.effects, cardUids);
  assertSnapshotChain(state.chain, cardUids, effectEvents);
  if (!isDuelStatus(state.status)) throw new Error("Malformed duel snapshot: state.status must be a duel status");
  if (!isDuelPhase(state.phase)) throw new Error("Malformed duel snapshot: state.phase must be a duel phase");
  if (state.winner !== undefined && state.winner !== "draw") assertSnapshotPlayerId(state.winner, "state.winner");
  if (state.winReason !== undefined) assertSnapshotNonNegativeInteger(state.winReason, "state.winReason");
  if (state.waitingFor !== undefined) assertSnapshotPlayerId(state.waitingFor, "state.waitingFor");
  if (state.battleStep !== undefined && !isBattleStep(state.battleStep)) throw new Error("Malformed duel snapshot: state.battleStep must be a battle step");
  if (state.prompt !== undefined) assertSnapshotPrompt(state.prompt);
  if (state.luaOperationPrompt !== undefined) assertSnapshotLuaOperationPrompt(state.luaOperationPrompt, cardUids);
  if (state.battleWindow !== undefined) assertSnapshotBattleWindow(state.battleWindow, cardUids);
  if (state.currentAttack !== undefined) assertSnapshotBattle(state.currentAttack, "state.currentAttack", cardUids);
  if (state.pendingBattle !== undefined) assertSnapshotBattle(state.pendingBattle, "state.pendingBattle", cardUids);
  assertSnapshotPendingWindowConsistency(state);
}
const duelSnapshotStateKeys = new Set(["actionWindowId", "actionWindowToken", "activityCounts", "activityHistory", "attackCanceledUids", "attackCostPaid", "attackPasses", "attackedTargetUids", "attacksDeclared", "battleDamage", "battlePairs", "battleStep", "battleWindow", "cards", "chain", "chainLimits", "chainPasses", "currentAttack", "damagePasses", "duelTypeFlags", "effects", "eventHistory", "flagEffects", "globalFlags", "id", "lastCoinResults", "lastDiceResults", "log", "luaOperationPrompt", "options", "pendingBattle", "pendingTriggerBuckets", "pendingTriggers", "phase", "phaseActivity", "players", "positionsChanged", "prompt", "randomCounter", "seed", "shuffleCheckDisabled", "skippedPhases", "status", "turn", "turnPlayer", "unofficialProcEnabled", "usedCountKeys", "waitingFor", "winner", "winReason"]);
const duelSnapshotCardKeys = new Set(["assumedProperties", "attackModifier", "battlePosition", "cancelToGrave", "cardTargetUids", "code", "controller", "counterBuckets", "counters", "customStatusMask", "data", "defenseModifier", "effectRelationIds", "equippedToUid", "faceUp", "fieldId", "kind", "levelModifier", "linkModifier", "location", "name", "overlayUids", "owner", "position", "previousAttack", "previousAttribute", "previousCodes", "previousController", "previousDefense", "previousEquippedToUid", "previousFaceUp", "previousLevel", "previousLink", "previousLocation", "previousPosition", "previousRace", "previousRank", "previousSequence", "previousSetcodes", "previousTypeFlags", "rankModifier", "reason", "reasonCardUid", "reasonEffectId", "reasonPlayer", "scaleModifier", "sequence", "summonMaterialUids", "summonPhase", "summonPlayer", "summonType", "summonTypeCode", "turnCounter", "turnId", "uid", "uniqueOnField"]);
const duelSnapshotCardDataKeys = new Set(["alias", "attack", "attribute", "code", "defense", "fitMonster", "fusionMaterials", "kind", "leftScale", "level", "linkMarkers", "linkMaterialAttribute", "linkMaterialLevel", "linkMaterialMax", "linkMaterialMin", "linkMaterialMinLevel", "linkMaterialRace", "linkMaterialSetcode", "linkMaterialSummonType", "linkMaterialType", "linkMaterials", "listedNames", "materialSetcodes", "name", "normalTributeMax", "normalTributeMin", "normalTributes", "race", "rightScale", "ritualMaterials", "setcodes", "synchroMaterials", "synchroNonTunerAttribute", "synchroNonTunerMax", "synchroNonTunerMin", "synchroNonTunerRace", "synchroNonTunerSetcode", "synchroNonTunerType", "synchroTunerAttribute", "synchroTunerLevel", "synchroTunerMax", "synchroTunerMin", "synchroTunerRace", "synchroTunerSetcode", "synchroTunerType", "typeFlags", "xyzMaterialAttribute", "xyzMaterialCount", "xyzMaterialMax", "xyzMaterialRace", "xyzMaterialRank", "xyzMaterialSetcode", "xyzMaterialType", "xyzMaterials"]);
const duelSnapshotEffectKeys = new Set(["category", "code", "controller", "copyId", "countLimit", "countLimitCode", "description", "event", "hintTiming", "id", "label", "labelObjectUid", "labelObjectUids", "luaConditionDescriptor", "luaCostDescriptor", "luaTargetDescriptor", "luaValueDescriptor", "oncePerTurn", "optional", "ownerPlayer", "property", "range", "registryKey", "reset", "sourceUid", "targetRange", "triggerCode", "triggerEvent", "triggerSourceOnly", "triggerTiming", "value"]);
const duelSnapshotNestedKeys = { activityHistory: new Set(["activity", "cardUid", "effectId", "player"]), battle: new Set(["attackerUid", "battleDamageOverrides", "deferredBattleDestroyed", "replayTargetCount", "replayTargetUids", "resultApplied", "targetUid"]), battlePair: new Set(["attackerUid", "targetUid"]), battleWindow: new Set(["attackNegated", "attackerUid", "id", "kind", "responsePlayer", "step", "targetUid"]), chainLink: new Set(["activationLocation", "activationSequence", "chainIndex", "disablePlayer", "disableReason", "effectId", "effectLabel", "effectLabelObjectUid", "effectLabelObjectUids", "effectLabels", "eventCardUid", "eventChainDepth", "eventChainLinkId", "eventCode", "eventCurrentState", "eventName", "eventPlayer", "eventPreviousState", "eventReason", "eventReasonCardUid", "eventReasonEffectId", "eventReasonPlayer", "eventTriggerTiming", "eventUids", "eventValue", "id", "negated", "operationInfos", "player", "possibleOperationInfos", "relatedEffectId", "sourceUid", "targetParam", "targetPlayer", "targetUids"]), chainLimit: new Set(["expiresAtChainLength", "registryKey", "untilChainEnd"]), effectReset: new Set(["count", "flags"]), eventCardState: new Set(["controller", "faceUp", "location", "position", "sequence"]), eventHistory: new Set(["eventCardUid", "eventChainDepth", "eventChainLinkId", "eventCode", "eventCurrentState", "eventName", "eventPlayer", "eventPreviousState", "eventReason", "eventReasonCardUid", "eventReasonEffectId", "eventReasonPlayer", "eventUids", "eventValue", "relatedEffectId"]), flagEffect: new Set(["code", "ownerId", "ownerType", "property", "reset", "resetCount", "turn", "value"]), log: new Set(["action", "card", "detail", "player", "step"]), luaOperationPrompt: new Set(["chainLink", "prompt"]), luaPromptDecision: new Set(["api", "description", "descriptionLists", "descriptions", "id", "options", "player", "returned", "returnKind", "returnValues"]), operationInfo: new Set(["category", "count", "parameter", "player", "targetUids"]), pendingTrigger: new Set(["effectId", "effectLabelObjectUid", "effectLabelObjectUids", "eventCardUid", "eventChainDepth", "eventChainLinkId", "eventCode", "eventCurrentState", "eventName", "eventPlayer", "eventPreviousState", "eventReason", "eventReasonCardUid", "eventReasonEffectId", "eventReasonPlayer", "eventTriggerTiming", "eventUids", "eventValue", "id", "player", "relatedEffectId", "sourceUid", "triggerBucket"]), pendingTriggerBucket: new Set(["player", "triggerBucket", "triggerIds"]), prompt: new Set(["description", "descriptionLists", "descriptions", "id", "options", "origin", "player", "returnTo", "type"]), skippedPhase: new Set(["phase", "player", "remaining"]), synchroMaterials: new Set(["nonTuners", "tuner"]), uniqueOnField: new Set(["code", "locationMask", "opponent", "self"]) };

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
    assertSnapshotFiniteNumber(value, `${path}.${index}`);
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
    if (!isRecord(pair)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(pair)) if (!duelSnapshotNestedKeys.battlePair.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
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
    if (!isRecord(trigger)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(trigger)) if (!duelSnapshotNestedKeys.pendingTrigger.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    for (const field of ["id", "sourceUid", "effectId", "eventName"] as const) {
      if (typeof trigger[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (!isDuelEventName(trigger.eventName)) throw new Error(`Malformed duel snapshot: ${path}.eventName must be a duel event`);
    if (trigger.eventTriggerTiming === undefined) throw new Error(`Malformed duel snapshot: ${path}.eventTriggerTiming is required`);
    const id = trigger.id as string;
    if (seenIds.has(id)) throw new Error(`Malformed duel snapshot: ${path}.id must be unique`);
    seenIds.add(id);
    assertSnapshotPlayerId(trigger.player, `${path}.player`);
    if (!isTriggerBucket(trigger.triggerBucket)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must be a trigger bucket`);
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
    if (!isRecord(bucket)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(bucket)) if (!duelSnapshotNestedKeys.pendingTriggerBucket.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    if (!isTriggerBucket(bucket.triggerBucket)) throw new Error(`Malformed duel snapshot: ${path}.triggerBucket must be a trigger bucket`);
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
    if (!isRecord(event)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(event)) if (!duelSnapshotNestedKeys.eventHistory.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    if (typeof event.eventName !== "string") throw new Error(`Malformed duel snapshot: ${path}.eventName must be a string`);
    if (!isDuelEventName(event.eventName)) throw new Error(`Malformed duel snapshot: ${path}.eventName must be a duel event`);
    assertSnapshotEventPayload(event, path, cardUids);
  }
}

function assertSnapshotEventPayload(payload: Record<string, unknown>, path: string, cardUids: ReadonlySet<string>): void {
  for (const field of ["eventCode", "eventValue", "eventReason"] as const) if (payload[field] !== undefined) assertSnapshotFiniteNumber(payload[field], `${path}.${field}`);
  for (const field of ["eventReasonEffectId", "relatedEffectId"] as const) if (payload[field] !== undefined) assertSnapshotNonNegativeInteger(payload[field], `${path}.${field}`);
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
  if (!isRecord(value)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(value)) if (!duelSnapshotNestedKeys.eventCardState.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  assertSnapshotPlayerId(value.controller, `${path}.controller`);
  if (!isDuelLocation(value.location)) throw new Error(`Malformed duel snapshot: ${path}.location must be a location`);
  assertSnapshotNonNegativeInteger(value.sequence, `${path}.sequence`);
  if (!isCardPosition(value.position)) throw new Error(`Malformed duel snapshot: ${path}.position must be a card position`);
  if (typeof value.faceUp !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.faceUp must be a boolean`);
}

function assertSnapshotChain(chain: unknown, cardUids: ReadonlySet<string>, effectEvents: ReadonlyMap<string, unknown> = new Map()): void {
  if (!Array.isArray(chain)) throw new Error("Malformed duel snapshot: state.chain must be an array");
  const seenIds = new Set<string>();
  for (const [index, link] of chain.entries()) {
    const path = `state.chain.${index}`;
    if (!isRecord(link)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(link)) if (!duelSnapshotNestedKeys.chainLink.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    for (const field of ["id", "sourceUid", "effectId"] as const) {
      if (typeof link[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    if (seenIds.has(link.id as string)) throw new Error(`Malformed duel snapshot: ${path}.id must be unique`); else seenIds.add(link.id as string);
    if (!cardUids.has(link.sourceUid as string)) throw new Error(`Malformed duel snapshot: ${path}.sourceUid must reference a card`);
    assertSnapshotPlayerId(link.player, `${path}.player`);
    if (link.activationLocation !== undefined && !isDuelLocation(link.activationLocation)) throw new Error(`Malformed duel snapshot: ${path}.activationLocation must be a card location`);
    for (const field of ["chainIndex", "activationSequence", "targetParam", "disableReason", "effectLabel"] as const) {
      if (link[field] !== undefined) assertSnapshotFiniteNumber(link[field], `${path}.${field}`);
    }
    if (link.effectLabels !== undefined) assertSnapshotNumberArray(link.effectLabels, `${path}.effectLabels`);
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
    const linkEffectEvent = effectEvents.get(`${link.sourceUid}:${link.effectId}`);
    if (linkEffectEvent === "trigger" && link.eventName !== undefined && link.eventTriggerTiming === undefined) {
      throw new Error(`Malformed duel snapshot: ${path}.eventTriggerTiming is required for trigger chain links`);
    }
    assertSnapshotEventPayload(link, path, cardUids);
  }
}

function assertSnapshotOperationInfos(value: unknown, path: string, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(value)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (const [index, info] of value.entries()) {
    const infoPath = `${path}.${index}`;
    if (!isRecord(info)) throw new Error(`Malformed duel snapshot: ${infoPath} must be an object`);
    for (const key of Object.keys(info)) if (!duelSnapshotNestedKeys.operationInfo.has(key)) throw new Error(`Malformed duel snapshot: ${infoPath}.${key} is not a known field`);
    for (const field of ["category", "count", "parameter"] as const) assertSnapshotFiniteNumber(info[field], `${infoPath}.${field}`);
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
    for (const key of Object.keys(limit)) if (!duelSnapshotNestedKeys.chainLimit.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
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
    for (const key of Object.keys(skip)) if (!duelSnapshotNestedKeys.skippedPhase.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    assertSnapshotPlayerId(skip.player, `${path}.player`);
    if (!isDuelPhase(skip.phase)) throw new Error(`Malformed duel snapshot: ${path}.phase must be a duel phase`);
    const remaining = skip.remaining;
    assertSnapshotFiniteNumber(remaining, `${path}.remaining`);
    if (remaining <= 0) throw new Error(`Malformed duel snapshot: ${path}.remaining must be positive`);
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
    for (const key of Object.keys(record)) if (!duelSnapshotNestedKeys.activityHistory.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    assertSnapshotPlayerId(record.player, `${path}.player`);
    assertSnapshotFiniteNumber(record.activity, `${path}.activity`);
    if (record.cardUid !== undefined) { if (typeof record.cardUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.cardUid must be a string`); if (!cardUids.has(record.cardUid)) throw new Error(`Malformed duel snapshot: ${path}.cardUid must reference a card`); }
    if (record.effectId !== undefined && typeof record.effectId !== "string") throw new Error(`Malformed duel snapshot: ${path}.effectId must be a string`);
  }
}

function assertSnapshotFlagEffects(flags: unknown, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(flags)) throw new Error("Malformed duel snapshot: state.flagEffects must be an array");
  for (const [index, flag] of flags.entries()) {
    const path = `state.flagEffects.${index}`;
    if (!isRecord(flag)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const key of Object.keys(flag)) if (!duelSnapshotNestedKeys.flagEffect.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    if (flag.ownerType !== "player" && flag.ownerType !== "card") throw new Error(`Malformed duel snapshot: ${path}.ownerType must be a flag owner type`);
    if (typeof flag.ownerId !== "string") throw new Error(`Malformed duel snapshot: ${path}.ownerId must be a string`);
    if (flag.ownerType === "player" && flag.ownerId !== "0" && flag.ownerId !== "1") throw new Error(`Malformed duel snapshot: ${path}.ownerId must be a player id`);
    if (flag.ownerType === "card" && !cardUids.has(flag.ownerId)) throw new Error(`Malformed duel snapshot: ${path}.ownerId must reference a card`);
    for (const field of ["code", "reset", "property", "value"] as const) {
      assertSnapshotFiniteNumber(flag[field], `${path}.${field}`);
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
    for (const key of Object.keys(entry)) if (!duelSnapshotNestedKeys.log.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
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
    for (const key of Object.keys(card)) if (!duelSnapshotCardKeys.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    for (const field of ["uid", "code", "name"] as const) {
      if (typeof card[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    const uid = card.uid as string;
    if (seenUids.has(uid)) throw new Error(`Malformed duel snapshot: ${path}.uid must be unique`);
    seenUids.add(uid);
    locationsByUid.set(uid, card.location);
    if (!isDuelCardKind(card.kind)) throw new Error(`Malformed duel snapshot: ${path}.kind must be a card kind`);
    assertSnapshotPlayerId(card.owner, `${path}.owner`);
    assertSnapshotPlayerId(card.controller, `${path}.controller`);
    if (!isDuelLocation(card.location)) throw new Error(`Malformed duel snapshot: ${path}.location must be a card location`);
    assertSnapshotNonNegativeInteger(card.sequence, `${path}.sequence`);
    if (!isCardPosition(card.position)) throw new Error(`Malformed duel snapshot: ${path}.position must be a card position`);
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
function assertSnapshotEffects(effects: unknown, cardUids: ReadonlySet<string>): Map<string, unknown> {
  if (!Array.isArray(effects)) throw new Error("Malformed duel snapshot: state.effects must be an array");
  const effectEvents = new Map<string, unknown>();
  const seenEffectKeys = new Set<string>();
  for (const [index, effect] of effects.entries()) {
    const path = `state.effects.${index}`;
    if (!isRecord(effect)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
    for (const key of Object.keys(effect)) if (!duelSnapshotEffectKeys.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
    for (const field of ["id", "sourceUid"] as const) {
      if (typeof effect[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
    }
    const effectKey = `${effect.sourceUid}:${effect.id}`;
    if (seenEffectKeys.has(effectKey)) throw new Error(`Malformed duel snapshot: ${path}.id must be unique per source`);
    seenEffectKeys.add(effectKey);
    if (!cardUids.has(effect.sourceUid as string)) throw new Error(`Malformed duel snapshot: ${path}.sourceUid must reference a card`);
    assertSnapshotPlayerId(effect.controller, `${path}.controller`);
    if (effect.ownerPlayer !== undefined) assertSnapshotPlayerId(effect.ownerPlayer, `${path}.ownerPlayer`);
    if (effect.registryKey !== undefined && typeof effect.registryKey !== "string") throw new Error(`Malformed duel snapshot: ${path}.registryKey must be a string`);
    if (!isDuelEffectEvent(effect.event)) throw new Error(`Malformed duel snapshot: ${path}.event must be an effect event`);
    effectEvents.set(`${effect.sourceUid}:${effect.id}`, effect.event);
    if (!Array.isArray(effect.range)) throw new Error(`Malformed duel snapshot: ${path}.range must be an array`);
    for (const [rangeIndex, location] of effect.range.entries()) {
      if (!isDuelLocation(location)) throw new Error(`Malformed duel snapshot: ${path}.range.${rangeIndex} must be a card location`);
    }
    for (const field of ["code", "value", "triggerCode", "countLimit", "countLimitCode", "label", "description", "category", "property", "copyId"] as const) {
      if (effect[field] !== undefined) assertSnapshotFiniteNumber(effect[field], `${path}.${field}`);
    }
    for (const field of ["triggerSourceOnly", "optional", "oncePerTurn"] as const) {
      if (effect[field] !== undefined && typeof effect[field] !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a boolean`);
    }
    if (effect.triggerEvent !== undefined && typeof effect.triggerEvent !== "string") throw new Error(`Malformed duel snapshot: ${path}.triggerEvent must be a string`);
    if (effect.triggerEvent !== undefined && !isDuelEventName(effect.triggerEvent)) throw new Error(`Malformed duel snapshot: ${path}.triggerEvent must be a duel event`);
    if (effect.triggerEvent !== undefined && effect.triggerTiming === undefined) throw new Error(`Malformed duel snapshot: ${path}.triggerTiming is required when triggerEvent is set`);
    if (effect.triggerTiming !== undefined && effect.triggerTiming !== "if" && effect.triggerTiming !== "when") throw new Error(`Malformed duel snapshot: ${path}.triggerTiming must be trigger timing`);
    if (effect.labelObjectUid !== undefined && typeof effect.labelObjectUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.labelObjectUid must be a string`);
    if (effect.labelObjectUid !== undefined && !cardUids.has(effect.labelObjectUid)) throw new Error(`Malformed duel snapshot: ${path}.labelObjectUid must reference a card`);
    if (effect.labelObjectUids !== undefined) { assertSnapshotStringArray(effect.labelObjectUids, `${path}.labelObjectUids`); assertSnapshotUniqueStringArray(effect.labelObjectUids, `${path}.labelObjectUids`); assertSnapshotCardUidArray(effect.labelObjectUids, `${path}.labelObjectUids`, cardUids); }
    if (effect.reset !== undefined) assertSnapshotEffectReset(effect.reset, `${path}.reset`);
    if (effect.targetRange !== undefined) assertSnapshotNumberTuple(effect.targetRange, `${path}.targetRange`);
    if (effect.hintTiming !== undefined) assertSnapshotNumberTuple(effect.hintTiming, `${path}.hintTiming`);
  }
  return effectEvents;
}

function assertSnapshotEffectReset(reset: unknown, path: string): void {
  if (!isRecord(reset)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const key of Object.keys(reset)) if (!duelSnapshotNestedKeys.effectReset.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  assertSnapshotFiniteNumber(reset.flags, `${path}.flags`);
  if (reset.count !== undefined) assertSnapshotNonNegativeInteger(reset.count, `${path}.count`);
}

function assertSnapshotNumberTuple(tuple: unknown, path: string): void {
  if (!Array.isArray(tuple)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  if (tuple.length < 1 || tuple.length > 2) throw new Error(`Malformed duel snapshot: ${path} must contain one or two numbers`);
  for (const [index, value] of tuple.entries()) {
    assertSnapshotFiniteNumber(value, `${path}.${index}`);
  }
}

function assertSnapshotOptionalCardState(card: Record<string, unknown>, path: string): void {
  for (const field of ["previousLocation"] as const) {
    if (card[field] !== undefined && !isDuelLocation(card[field])) throw new Error(`Malformed duel snapshot: ${path}.${field} must be a card location`);
  }
  if (card.previousController !== undefined) assertSnapshotPlayerId(card.previousController, `${path}.previousController`);
  if (card.reasonPlayer !== undefined) assertSnapshotPlayerId(card.reasonPlayer, `${path}.reasonPlayer`);
  if (card.summonPlayer !== undefined) assertSnapshotPlayerId(card.summonPlayer, `${path}.summonPlayer`);
  if (card.previousPosition !== undefined && !isCardPosition(card.previousPosition)) throw new Error(`Malformed duel snapshot: ${path}.previousPosition must be a card position`);
  if (card.battlePosition !== undefined && !isCardPosition(card.battlePosition)) throw new Error(`Malformed duel snapshot: ${path}.battlePosition must be a card position`);
  if (card.summonType !== undefined && !isDuelSummonType(card.summonType)) throw new Error(`Malformed duel snapshot: ${path}.summonType must be a summon type`);
  if (card.summonPhase !== undefined && !isDuelPhase(card.summonPhase)) throw new Error(`Malformed duel snapshot: ${path}.summonPhase must be a duel phase`);
  for (const field of ["fieldId", "previousSequence", "turnId", "turnCounter"] as const) {
    if (card[field] !== undefined) assertSnapshotNonNegativeInteger(card[field], `${path}.${field}`);
  }
  for (const field of ["reason", "reasonEffectId", "customStatusMask", "summonTypeCode", "attackModifier", "defenseModifier", "levelModifier", "rankModifier", "linkModifier", "scaleModifier", "previousTypeFlags", "previousAttack", "previousDefense", "previousLevel", "previousRank", "previousLink", "previousRace", "previousAttribute"] as const) {
    if (card[field] !== undefined) assertSnapshotFiniteNumber(card[field], `${path}.${field}`);
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
  for (const key of Object.keys(unique)) if (!duelSnapshotNestedKeys.uniqueOnField.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  for (const field of ["self", "opponent"] as const) {
    if (typeof unique[field] !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a boolean`);
  }
  for (const field of ["code", "locationMask"] as const) {
    assertSnapshotFiniteNumber(unique[field], `${path}.${field}`);
  }
}

function assertSnapshotCardData(data: unknown, path: string): void {
  if (!isRecord(data)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const key of Object.keys(data)) if (!duelSnapshotCardDataKeys.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  for (const field of ["code", "name"] as const) {
    if (typeof data[field] !== "string") throw new Error(`Malformed duel snapshot: ${path}.${field} must be a string`);
  }
  if (!isDuelCardKind(data.kind)) throw new Error(`Malformed duel snapshot: ${path}.kind must be a card kind`);
  for (const field of ["typeFlags", "level", "normalTributes", "normalTributeMin", "normalTributeMax", "leftScale", "rightScale", "linkMarkers", "attack", "defense", "race", "attribute", "synchroTunerMin", "synchroTunerMax", "synchroTunerLevel", "synchroTunerAttribute", "synchroTunerRace", "synchroTunerType", "synchroTunerSetcode", "synchroNonTunerMin", "synchroNonTunerMax", "synchroNonTunerAttribute", "synchroNonTunerRace", "synchroNonTunerType", "synchroNonTunerSetcode", "xyzMaterialCount", "xyzMaterialMax", "xyzMaterialRace", "xyzMaterialAttribute", "xyzMaterialType", "xyzMaterialSetcode", "xyzMaterialRank", "linkMaterialMin", "linkMaterialMax", "linkMaterialType", "linkMaterialRace", "linkMaterialAttribute", "linkMaterialSetcode", "linkMaterialSummonType", "linkMaterialLevel", "linkMaterialMinLevel"] as const) {
    if (data[field] !== undefined) assertSnapshotFiniteNumber(data[field], `${path}.${field}`);
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
  for (const key of Object.keys(data.synchroMaterials)) if (!duelSnapshotNestedKeys.synchroMaterials.has(key)) throw new Error(`Malformed duel snapshot: ${path}.synchroMaterials.${key} is not a known field`);
  if (typeof data.synchroMaterials.tuner !== "string") throw new Error(`Malformed duel snapshot: ${path}.synchroMaterials.tuner must be a string`);
  assertSnapshotStringArray(data.synchroMaterials.nonTuners, `${path}.synchroMaterials.nonTuners`);
}

function assertSnapshotNumberRecord(record: unknown, path: string): void {
  if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const [key, value] of Object.entries(record)) {
    if (!/^\d+$/.test(key)) throw new Error(`Malformed duel snapshot: ${path} must use numeric keys`);
    assertSnapshotFiniteNumber(value, `${path}.${key}`);
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
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`); if (!Number.isInteger(value) || value < 0) throw new Error(`Malformed duel snapshot: ${path} must be a non-negative integer`);
}
function assertSnapshotSafeNonNegativeInteger(value: unknown, path: string): void {
  assertSnapshotNonNegativeInteger(value, path); if (!Number.isSafeInteger(value)) throw new Error(`Malformed duel snapshot: ${path} must be a safe integer`);
}
function assertSnapshotPositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`); if (!Number.isInteger(value) || value <= 0) throw new Error(`Malformed duel snapshot: ${path} must be a positive integer`);
}
function assertSnapshotFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`); if (!Number.isFinite(value)) throw new Error(`Malformed duel snapshot: ${path} must be a finite number`);
}

function assertSnapshotPlayers(players: unknown): void {
  if (!isRecord(players)) throw new Error("Malformed duel snapshot: state.players must be an object"); for (const key of Object.keys(players)) if (key !== "0" && key !== "1") throw new Error("Malformed duel snapshot: state.players must use player ids");
  assertSnapshotPlayer(players[0], 0);
  assertSnapshotPlayer(players[1], 1);
}

function assertSnapshotPlayer(player: unknown, expectedId: PlayerId): void {
  const path = `state.players.${expectedId}`;
  if (!isRecord(player)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(player)) if (!["id", "lifePoints", "normalSummonAvailable", "pendulumSummonAvailable", "extraPendulumSummons", "extraPendulumSummonGrants", "initialMainDeckSize"].includes(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  if (player.id !== expectedId) throw new Error(`Malformed duel snapshot: ${path}.id must match the player id`);
  assertSnapshotNonNegativeInteger(player.lifePoints, `${path}.lifePoints`);
  if (typeof player.normalSummonAvailable !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.normalSummonAvailable must be a boolean`);
  if (typeof player.pendulumSummonAvailable !== "boolean") throw new Error(`Malformed duel snapshot: ${path}.pendulumSummonAvailable must be a boolean`);
  if (player.extraPendulumSummons !== undefined) assertSnapshotNonNegativeInteger(player.extraPendulumSummons, `${path}.extraPendulumSummons`); if (player.extraPendulumSummonGrants !== undefined) { if (!Array.isArray(player.extraPendulumSummonGrants)) throw new Error(`Malformed duel snapshot: ${path}.extraPendulumSummonGrants must be an array`); for (const [index, grant] of player.extraPendulumSummonGrants.entries()) { const grantPath = `${path}.extraPendulumSummonGrants.${index}`; if (!isRecord(grant)) throw new Error(`Malformed duel snapshot: ${grantPath} must be an object`); for (const key of Object.keys(grant)) if (!["locationMask", "scalePlayer", "scaleAlternatives", "setcode"].includes(key)) throw new Error(`Malformed duel snapshot: ${grantPath}.${key} is not a known field`); if (grant.locationMask !== undefined) assertSnapshotNonNegativeInteger(grant.locationMask, `${grantPath}.locationMask`); if (grant.scalePlayer !== undefined) assertSnapshotPlayerId(grant.scalePlayer, `${grantPath}.scalePlayer`); if (grant.setcode !== undefined) assertSnapshotNonNegativeInteger(grant.setcode, `${grantPath}.setcode`); if (grant.scaleAlternatives !== undefined) { if (!Array.isArray(grant.scaleAlternatives)) throw new Error(`Malformed duel snapshot: ${grantPath}.scaleAlternatives must be an array`); for (const [altIndex, alternative] of grant.scaleAlternatives.entries()) { const altPath = `${grantPath}.scaleAlternatives.${altIndex}`; if (!isRecord(alternative)) throw new Error(`Malformed duel snapshot: ${altPath} must be an object`); for (const key of Object.keys(alternative)) if (!["locationMask", "scalePlayer"].includes(key)) throw new Error(`Malformed duel snapshot: ${altPath}.${key} is not a known field`); if (alternative.locationMask !== undefined) assertSnapshotNonNegativeInteger(alternative.locationMask, `${altPath}.locationMask`); assertSnapshotPlayerId(alternative.scalePlayer, `${altPath}.scalePlayer`); } } } } if (player.initialMainDeckSize !== undefined) assertSnapshotNonNegativeInteger(player.initialMainDeckSize, `${path}.initialMainDeckSize`);
}

function assertSnapshotOptions(options: unknown): void {
  if (!isRecord(options)) throw new Error("Malformed duel snapshot: state.options must be an object"); for (const key of Object.keys(options)) if (!["startingLifePoints", "startingHandSize", "drawPerTurn"].includes(key)) throw new Error(`Malformed duel snapshot: state.options.${key} is not a known field`);
  for (const field of ["startingLifePoints", "startingHandSize", "drawPerTurn"] as const) {
    assertSnapshotNonNegativeInteger(options[field], `state.options.${field}`);
  }
}

function assertSnapshotActivityCounts(counts: unknown): void {
  if (!isRecord(counts)) throw new Error("Malformed duel snapshot: state.activityCounts must be an object"); for (const key of Object.keys(counts)) if (key !== "0" && key !== "1") throw new Error("Malformed duel snapshot: state.activityCounts must use player ids");
  assertSnapshotActivityCount(counts[0], "state.activityCounts.0");
  assertSnapshotActivityCount(counts[1], "state.activityCounts.1");
}

function assertSnapshotActivityCount(count: unknown, path: string): void {
  if (!isRecord(count)) throw new Error(`Malformed duel snapshot: ${path} must be an object`); for (const key of Object.keys(count)) if (!["summon", "normalSummon", "specialSummon", "flipSummon", "attack"].includes(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  for (const field of ["summon", "normalSummon", "specialSummon", "flipSummon", "attack"] as const) {
    assertSnapshotNonNegativeInteger(count[field], `${path}.${field}`);
  }
}

function assertSnapshotBattleDamage(battleDamage: unknown): void {
  if (!isRecord(battleDamage)) throw new Error("Malformed duel snapshot: state.battleDamage must be an object"); for (const key of Object.keys(battleDamage)) if (key !== "0" && key !== "1") throw new Error("Malformed duel snapshot: state.battleDamage must use player ids");
  for (const player of [0, 1] as const) {
    assertSnapshotNonNegativeInteger(battleDamage[player], `state.battleDamage.${player}`);
  }
}

function assertSnapshotPrompt(prompt: unknown): asserts prompt is DuelPromptState {
  if (!isRecord(prompt)) throw new Error("Malformed duel snapshot: state.prompt must be an object");
  for (const key of Object.keys(prompt)) if (!duelSnapshotNestedKeys.prompt.has(key)) throw new Error(`Malformed duel snapshot: state.prompt.${key} is not a known field`);
  if (typeof prompt.id !== "string") throw new Error("Malformed duel snapshot: state.prompt.id must be a string");
  assertSnapshotPlayerId(prompt.player, "state.prompt.player");
  if (prompt.returnTo !== undefined) assertSnapshotPlayerId(prompt.returnTo, "state.prompt.returnTo");
  if (prompt.origin !== undefined && prompt.origin !== "luaOperation") throw new Error("Malformed duel snapshot: state.prompt.origin must be a prompt origin");
  if (!isDuelPromptType(prompt.type)) throw new Error("Malformed duel snapshot: state.prompt.type must be a prompt type");
  if (prompt.type === "selectOption") {
    if (!Array.isArray(prompt.options)) throw new Error("Malformed duel snapshot: state.prompt.options must be an array"); if (prompt.options.some((option) => !Number.isSafeInteger(option))) throw new Error("Malformed duel snapshot: state.prompt.options must contain safe integers");
    if (new Set(prompt.options).size !== prompt.options.length) throw new Error("Malformed duel snapshot: state.prompt.options must be unique");
    if (prompt.description !== undefined) throw new Error("Malformed duel snapshot: state.prompt.description is only valid for selectYesNo");
    if (prompt.descriptions !== undefined) {
      if (!Array.isArray(prompt.descriptions)) throw new Error("Malformed duel snapshot: state.prompt.descriptions must be an array");
      if (prompt.descriptions.some((description) => !Number.isSafeInteger(description))) throw new Error("Malformed duel snapshot: state.prompt.descriptions must contain safe integers");
      if (prompt.descriptions.length !== prompt.options.length) throw new Error("Malformed duel snapshot: state.prompt.descriptions must match options length");
    }
    if (prompt.descriptionLists !== undefined) {
      if (!Array.isArray(prompt.descriptionLists)) throw new Error("Malformed duel snapshot: state.prompt.descriptionLists must be an array");
      if (prompt.descriptionLists.length !== prompt.options.length) throw new Error("Malformed duel snapshot: state.prompt.descriptionLists must match options length");
      prompt.descriptionLists.forEach((descriptions, index) => assertSnapshotSafeIntegerArray(descriptions, `state.prompt.descriptionLists.${index}`));
    }
    return;
  }
  if (prompt.type === "selectYesNo") {
    if (prompt.description !== undefined && !Number.isSafeInteger(prompt.description)) throw new Error("Malformed duel snapshot: state.prompt.description must be a safe integer");
    if (prompt.descriptions !== undefined) throw new Error("Malformed duel snapshot: state.prompt.descriptions is only valid for selectOption");
    if (prompt.descriptionLists !== undefined) throw new Error("Malformed duel snapshot: state.prompt.descriptionLists is only valid for selectOption");
    return;
  }
}

function assertSnapshotLuaOperationPrompt(value: unknown, cardUids: ReadonlySet<string>): void {
  if (!isRecord(value)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt must be an object");
  for (const key of Object.keys(value)) if (!duelSnapshotNestedKeys.luaOperationPrompt.has(key)) throw new Error(`Malformed duel snapshot: state.luaOperationPrompt.${key} is not a known field`);
  if (value.chainLink === undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.chainLink is required");
  if (value.prompt === undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt is required");
  assertSnapshotChain([value.chainLink], cardUids);
  assertSnapshotLuaPromptDecision(value.prompt);
}

function assertSnapshotLuaPromptDecision(prompt: unknown): void {
  if (!isRecord(prompt)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt must be an object");
  for (const key of Object.keys(prompt)) if (!duelSnapshotNestedKeys.luaPromptDecision.has(key)) throw new Error(`Malformed duel snapshot: state.luaOperationPrompt.prompt.${key} is not a known field`);
  if (typeof prompt.id !== "string") throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.id must be a string");
  if (prompt.player !== undefined) assertSnapshotPlayerId(prompt.player, "state.luaOperationPrompt.prompt.player");
  if (isLuaOptionPromptApi(prompt.api)) {
    if (!Array.isArray(prompt.options)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.options must be an array");
    if (prompt.options.some((option) => !Number.isSafeInteger(option))) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.options must contain safe integers");
    if (!Array.isArray(prompt.descriptions)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptions must be an array");
    if (prompt.descriptions.some((description) => !Number.isSafeInteger(description))) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptions must contain safe integers");
    if (prompt.descriptions.length !== prompt.options.length) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptions must match options length");
    if (prompt.descriptionLists !== undefined) {
      if (!Array.isArray(prompt.descriptionLists)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptionLists must be an array");
      if (prompt.descriptionLists.length !== prompt.options.length) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptionLists must match options length");
      prompt.descriptionLists.forEach((descriptions, index) => assertSnapshotSafeIntegerArray(descriptions, `state.luaOperationPrompt.prompt.descriptionLists.${index}`));
    }
    if (!Number.isSafeInteger(prompt.returned)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returned must be a safe integer");
    if (prompt.returnKind !== undefined && !(prompt.api === "SelectCardsFromCodes" && prompt.returnKind === "codeIndexTable")) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnKind must match the Lua prompt api");
    if (prompt.returnValues !== undefined) assertSnapshotLuaPromptReturnValues(prompt.returnValues, prompt.options.length);
    if (prompt.description !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.description is only valid for yes/no prompt APIs");
    return;
  }
  if (isLuaYesNoPromptApi(prompt.api)) {
    if (typeof prompt.returned !== "boolean") throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returned must be a boolean");
    if (prompt.description !== undefined && !Number.isSafeInteger(prompt.description)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.description must be a safe integer");
    if (prompt.options !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.options is only valid for option-like prompt APIs");
    if (prompt.descriptions !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptions is only valid for option-like prompt APIs");
    if (prompt.descriptionLists !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptionLists is only valid for option-like prompt APIs");
    if (prompt.returnKind !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnKind is only valid for SelectCardsFromCodes");
    if (prompt.returnValues !== undefined) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnValues is only valid for option-like prompt APIs");
    return;
  }
  throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.api must be a Lua prompt api");
}

function assertSnapshotSafeIntegerArray(value: unknown, path: string): void { if (!Array.isArray(value)) throw new Error(`Malformed duel snapshot: ${path} must be an array`); if (value.some((entry) => !Number.isSafeInteger(entry))) throw new Error(`Malformed duel snapshot: ${path} must contain safe integers`); }

function assertSnapshotLuaPromptReturnValues(value: unknown, optionCount: number): void {
  if (!Array.isArray(value)) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnValues must be an array");
  if (value.length !== optionCount) throw new Error("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnValues must match options length");
  value.forEach((values, index) => { if (!Array.isArray(values)) throw new Error(`Malformed duel snapshot: state.luaOperationPrompt.prompt.returnValues.${index} must be an array`); values.forEach((resumeValue, valueIndex) => assertSnapshotLuaPromptReturnValue(resumeValue, `state.luaOperationPrompt.prompt.returnValues.${index}.${valueIndex}`)); });
}

function assertSnapshotLuaPromptReturnValue(value: unknown, path: string): void {
  if (typeof value === "boolean" || Number.isSafeInteger(value)) return;
  if (!isRecord(value)) throw new Error(`Malformed duel snapshot: ${path} must be a Lua prompt resume value`);
  for (const key of Object.keys(value)) if (key !== "code" && key !== "index") throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  if (!Number.isSafeInteger(value.code)) throw new Error(`Malformed duel snapshot: ${path}.code must be a safe integer`);
  if (!Number.isSafeInteger(value.index)) throw new Error(`Malformed duel snapshot: ${path}.index must be a safe integer`);
}

function assertSnapshotBattleWindow(window: unknown, cardUids: ReadonlySet<string>): void {
  if (!isRecord(window)) throw new Error("Malformed duel snapshot: state.battleWindow must be an object");
  for (const key of Object.keys(window)) if (!duelSnapshotNestedKeys.battleWindow.has(key)) throw new Error(`Malformed duel snapshot: state.battleWindow.${key} is not a known field`);
  assertSnapshotSafeNonNegativeInteger(window.id, "state.battleWindow.id");
  if (!isBattleWindowKind(window.kind)) throw new Error("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
  if (!isBattleStep(window.step)) throw new Error("Malformed duel snapshot: state.battleWindow.step must be a battle step");
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
  for (const key of Object.keys(battle)) if (!duelSnapshotNestedKeys.battle.has(key)) throw new Error(`Malformed duel snapshot: ${path}.${key} is not a known field`);
  if (typeof battle.attackerUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.attackerUid must be a string`);
  if (battle.targetUid !== undefined && typeof battle.targetUid !== "string") throw new Error(`Malformed duel snapshot: ${path}.targetUid must be a string`);
  if (!cardUids.has(battle.attackerUid)) throw new Error(`Malformed duel snapshot: ${path}.attackerUid must reference a card`);
  if (battle.targetUid !== undefined && !cardUids.has(battle.targetUid)) throw new Error(`Malformed duel snapshot: ${path}.targetUid must reference a card`);
  if (battle.replayTargetCount !== undefined) assertSnapshotSafeNonNegativeInteger(battle.replayTargetCount, `${path}.replayTargetCount`);
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
  const { battleDamageValue: _battleDamageValue, canActivate: _canActivate, cost: _cost, forceMonsterZoneValue: _forceMonsterZoneValue, labelObjectUid, labelObjectUids, lifePointValue: _lifePointValue, luaTypeFlags: _luaTypeFlags, operation: _operation, promptOperation: _promptOperation, statValue: _statValue, target: _target, targetCardPredicate: _targetCardPredicate, valueCardPredicate: _valueCardPredicate, valuePredicate: _valuePredicate, ...metadata } = effect;
  return {
    ...metadata,
    range: [...effect.range],
    ...(effect.reset ? { reset: { ...effect.reset } } : {}),
    ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
    ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
    ...(labelObjectUid === undefined ? {} : { labelObjectUid }),
    ...(labelObjectUids === undefined ? {} : { labelObjectUids: [...labelObjectUids] }),
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
  return effect.battleDamageValue !== undefined || effect.forceMonsterZoneValue !== undefined || effect.lifePointValue !== undefined || effect.statValue !== undefined || effect.targetCardPredicate !== undefined || effect.valueCardPredicate !== undefined || effect.valuePredicate !== undefined;
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
