import { copyDuelActivityCounts } from "#duel/activity.js";
import { copyBattleWindowState } from "#duel/battle-window-state.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import type {
  DuelCardInstance,
  DuelCardReader,
  DuelEffectDefinition,
  DuelEffectContext,
  ChainLimit,
  DuelPromptState,
  DuelSession,
  DuelState,
  PlayerId,
  PublicDuelCard,
  PublicDuelState,
  SerializedDuel,
} from "#duel/types.js";

export type DuelEffectRestoreFactory = (effect: DuelEffectDefinition) => DuelEffectDefinition;
export type DuelEffectRestoreRegistry = Record<string, DuelEffectRestoreFactory>;
export type DuelChainLimitRestoreFactory = (limit: ChainLimit) => ChainLimit;
export type DuelChainLimitRestoreRegistry = Record<string, DuelChainLimitRestoreFactory>;

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
    chain: state.chain.map(copyChainLink),
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
  return {
    version: 1,
    state: {
      ...session.state,
      players: {
        0: { ...session.state.players[0] },
        1: { ...session.state.players[1] },
      },
      cards: session.state.cards.map(copyCard),
      effects: session.state.effects.flatMap(serializeEffect),
      chain: session.state.chain.map(copyChainLink),
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
}

export function restoreDuel(
  snapshot: SerializedDuel,
  cardReader: DuelCardReader = fallbackCardReader,
  effectRegistry: DuelEffectRestoreRegistry = {},
  chainLimitRegistry: DuelChainLimitRestoreRegistry = {},
): DuelSession {
  if (snapshot.version !== 1) throw new Error(`Unsupported duel snapshot version ${snapshot.version}`);
  return {
    cardReader,
    state: {
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
    },
  };
}

function serializeEffect(effect: DuelEffectDefinition): DuelEffectDefinition[] {
  if (!isStaticContinuousEffect(effect) && effect.registryKey === undefined) return [];
  return [copySerializedEffect(effect)];
}

function copySerializedEffect(effect: DuelEffectDefinition): DuelEffectDefinition {
  const { canActivate: _canActivate, cost: _cost, target: _target, operation: _operation, ...metadata } = effect;
  return {
    ...metadata,
    range: [...effect.range],
    ...(effect.reset ? { reset: { ...effect.reset } } : {}),
    ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
    ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
    operation: noopEffectOperation,
  };
}

function restoreEffect(effect: DuelEffectDefinition, effectRegistry: DuelEffectRestoreRegistry): DuelEffectDefinition[] {
  if (effect.registryKey !== undefined) {
    const factory = effectRegistry[effect.registryKey];
    return factory ? [factory(copySerializedEffect(effect))] : [];
  }
  if (!isStaticContinuousEffect(effect)) return [];
  return [copySerializedEffect(effect)];
}

function serializeChainLimit(limit: ChainLimit): ChainLimit[] {
  if (limit.registryKey === undefined) return [];
  return [copySerializedChainLimit(limit)];
}

function copySerializedChainLimit(limit: ChainLimit): ChainLimit {
  const { allows: _allows, release: _release, ...metadata } = limit;
  return { ...metadata, allows: denyChainLimit };
}

function restoreChainLimit(limit: ChainLimit, chainLimitRegistry: DuelChainLimitRestoreRegistry): ChainLimit[] {
  if (limit.registryKey === undefined) return [];
  const factory = chainLimitRegistry[limit.registryKey];
  return factory ? [factory(copySerializedChainLimit(limit))] : [];
}

function isStaticContinuousEffect(effect: DuelEffectDefinition): boolean {
  return effect.event === "continuous" && effect.canActivate === undefined && effect.cost === undefined && effect.target === undefined;
}

function noopEffectOperation(_ctx: DuelEffectContext): void {}

function denyChainLimit(_effect: DuelEffectDefinition, _player: PlayerId, _chainPlayer: PlayerId): boolean {
  return false;
}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return { ...link, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
}

function copyCard(card: DuelCardInstance): DuelCardInstance {
  return {
    ...card,
    data: { ...card.data },
    overlayUids: [...card.overlayUids],
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(card.effectRelationIds ? { effectRelationIds: [...card.effectRelationIds] } : {}),
    ...(card.cardTargetUids ? { cardTargetUids: [...card.cardTargetUids] } : {}),
    ...(card.summonMaterialUids ? { summonMaterialUids: [...card.summonMaterialUids] } : {}),
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
