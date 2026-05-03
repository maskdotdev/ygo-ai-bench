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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
