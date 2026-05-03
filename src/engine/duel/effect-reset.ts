import { clearEffectCountUsage } from "#duel/effect-counts.js";
import {
  destinationResetFlags,
  matchesDestinationReset,
  matchesMovementReset,
  normalizeResetFlags,
  phaseResetFlag,
  resetChain,
  resetEvent,
  resetLeave,
  resetPhase,
} from "#duel/reset-flags.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelPhase, DuelState } from "#duel/types.js";

export function pruneResetEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    if ((flags & resetLeave) !== 0 && card.previousLocation !== card.location) return removeResetEffect(state, effect);
    if (matchesMovementReset(flags, card)) return removeResetEffect(state, effect);
    if ((flags & destinationResetFlags) !== 0) return matchesDestinationReset(flags, card) ? removeResetEffect(state, effect) : true;
    const previousLocation = card.previousLocation ?? card.location;
    return !effect.range.includes(previousLocation) || effect.range.includes(card.location) || removeResetEffect(state, effect);
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
