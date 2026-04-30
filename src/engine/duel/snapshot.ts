import { copyDuelActivityCounts } from "#duel/activity.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import type {
  DuelCardInstance,
  DuelCardReader,
  DuelEffectDefinition,
  DuelEffectContext,
  DuelPromptState,
  DuelSession,
  DuelState,
  PublicDuelCard,
  PublicDuelState,
  SerializedDuel,
} from "#duel/types.js";

export type DuelEffectRestoreFactory = (effect: DuelEffectDefinition) => DuelEffectDefinition;
export type DuelEffectRestoreRegistry = Record<string, DuelEffectRestoreFactory>;

export function queryPublicState(session: DuelSession): PublicDuelState {
  const state = session.state;
  return {
    id: state.id,
    status: state.status,
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
    attackPasses: [...state.attackPasses],
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
      cards: session.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: session.state.effects.flatMap(serializeEffect),
      chain: session.state.chain.map(copyChainLink),
      chainLimits: [],
      chainPasses: [...session.state.chainPasses],
      pendingTriggers: session.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...session.state.usedCountKeys],
      flagEffects: session.state.flagEffects.map((flag) => ({ ...flag })),
      skippedPhases: session.state.skippedPhases.map((skip) => ({ ...skip })),
      activityCounts: copyDuelActivityCounts(session.state.activityCounts),
      battleDamage: { ...session.state.battleDamage },
      attacksDeclared: [...session.state.attacksDeclared],
      attackPasses: [...session.state.attackPasses],
      positionsChanged: [...session.state.positionsChanged],
      ...(session.state.currentAttack === undefined ? {} : { currentAttack: { ...session.state.currentAttack } }),
      ...(session.state.pendingBattle === undefined ? {} : { pendingBattle: { ...session.state.pendingBattle } }),
      ...(session.state.prompt === undefined ? {} : { prompt: copyPrompt(session.state.prompt) }),
      log: session.state.log.map((entry) => ({ ...entry })),
    },
  };
}

export function restoreDuel(snapshot: SerializedDuel, cardReader: DuelCardReader = fallbackCardReader, effectRegistry: DuelEffectRestoreRegistry = {}): DuelSession {
  if (snapshot.version !== 1) throw new Error(`Unsupported duel snapshot version ${snapshot.version}`);
  return {
    cardReader,
    state: {
      ...snapshot.state,
      players: {
        0: { ...snapshot.state.players[0] },
        1: { ...snapshot.state.players[1] },
      },
      cards: snapshot.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: snapshot.state.effects.flatMap((effect) => restoreEffect(effect, effectRegistry)),
      chain: snapshot.state.chain.map(copyChainLink),
      chainLimits: [],
      chainPasses: [...snapshot.state.chainPasses],
      pendingTriggers: snapshot.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...snapshot.state.usedCountKeys],
      flagEffects: snapshot.state.flagEffects.map((flag) => ({ ...flag })),
      skippedPhases: snapshot.state.skippedPhases.map((skip) => ({ ...skip })),
      activityCounts: copyDuelActivityCounts(snapshot.state.activityCounts),
      battleDamage: { ...snapshot.state.battleDamage },
      attacksDeclared: [...snapshot.state.attacksDeclared],
      attackPasses: [...snapshot.state.attackPasses],
      positionsChanged: [...snapshot.state.positionsChanged],
      ...(snapshot.state.currentAttack === undefined ? {} : { currentAttack: { ...snapshot.state.currentAttack } }),
      ...(snapshot.state.pendingBattle === undefined ? {} : { pendingBattle: { ...snapshot.state.pendingBattle } }),
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

function isStaticContinuousEffect(effect: DuelEffectDefinition): boolean {
  return effect.event === "continuous" && effect.canActivate === undefined && effect.cost === undefined && effect.target === undefined;
}

function noopEffectOperation(_ctx: DuelEffectContext): void {}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return { ...link, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
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
  };
}
