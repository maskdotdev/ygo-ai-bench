import { clearEffectCountUsage } from "#duel/effect-counts.js";
import {
  destinationResetFlags,
  matchesDestinationReset,
  matchesDisableReset,
  matchesLeaveReset,
  matchesMovementReset,
  matchesTemporaryRemove,
  matchesTurnSetReset,
  matchesTurnReset,
  normalizeResetFlags,
  phaseResetFlag,
  resetChain,
  resetEvent,
  resetPhase,
} from "#duel/reset-flags.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelPhase, DuelState } from "#duel/types.js";

export function pruneResetEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    if (matchesLeaveReset(flags, card)) return decrementOrRemoveResetEffect(state, effect);
    if (matchesMovementReset(flags, card)) return decrementOrRemoveResetEffect(state, effect);
    if ((flags & destinationResetFlags) !== 0) return matchesDestinationReset(flags, card) ? decrementOrRemoveResetEffect(state, effect) : true;
    if (matchesTemporaryRemove(card)) return true;
    const previousLocation = card.previousLocation ?? card.location;
    return !effect.range.includes(previousLocation) || effect.range.includes(card.location) || decrementOrRemoveResetEffect(state, effect);
  });
}

export function pruneResetEffectsAfterPositionChange(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    return matchesTurnSetReset(flags, card) ? decrementOrRemoveResetEffect(state, effect) : true;
  });
}

export function pruneResetEffectsAfterDisable(state: DuelState, card: DuelCardInstance, ignoredEffectId?: string): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid || effect.id === ignoredEffectId) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    return matchesDisableReset(flags) ? decrementOrRemoveResetEffect(state, effect) : true;
  });
}

export function pruneResetEffectsAfterPhase(state: DuelState, phase: DuelPhase): void {
  pruneResetEffectsAfterPhaseFlag(state, phaseResetFlag(phase));
}

export function pruneResetEffectsAfterPhaseFlag(state: DuelState, phaseFlag: number): void {
  state.effects = state.effects.filter((effect) => {
    const reset = effect.reset;
    const flags = normalizeResetFlags(reset?.flags ?? 0);
    if (!reset || (flags & resetPhase) === 0 || (flags & phaseFlag) === 0) return true;
    if (!matchesTurnReset(flags, effect.controller, state.turnPlayer)) return true;
    if (reset.count !== undefined && reset.count > 1) {
      reset.count -= 1;
      return true;
    }
    return removeResetEffect(state, effect);
  });
}

export function pruneResetEffectsAfterChain(state: DuelState): void {
  state.effects = state.effects.filter((effect) => {
    const reset = effect.reset;
    const flags = normalizeResetFlags(reset?.flags ?? 0);
    if (!reset || (flags & resetChain) === 0) return true;
    if (reset.count !== undefined && reset.count > 1) {
      reset.count -= 1;
      return true;
    }
    return removeResetEffect(state, effect);
  });
}

function removeResetEffect(state: DuelState, effect: DuelEffectDefinition): false {
  clearEffectCountUsage(state, effect);
  return false;
}

function decrementOrRemoveResetEffect(state: DuelState, effect: DuelEffectDefinition): boolean {
  const reset = effect.reset;
  if (reset?.count !== undefined && reset.count > 1) {
    reset.count -= 1;
    return true;
  }
  return removeResetEffect(state, effect);
}
