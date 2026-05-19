import { clearEffectCountUsage } from "#duel/effect-counts.js";
import { getDuelCardCounter, removeDuelCardCounter, removeDuelCardResetWhileNegatedCounters } from "#duel/counters.js";
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

const effectCounterPermit = 0x10000;
const counterEffectMask = 0xf0000;
const counterTypeMask = 0xffff;
const effectTypeSingle = 0x1;

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
  removeDuelCardResetWhileNegatedCounters(card);
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid || effect.id === ignoredEffectId) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    return matchesDisableReset(flags) ? decrementOrRemoveResetEffect(state, effect) : true;
  });
}

export function resetDuelCardEffects(state: DuelState, card: DuelCardInstance, predicate: (effect: DuelEffectDefinition) => boolean): number {
  let removed = 0;
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid || !predicate(effect)) return true;
    removed += 1;
    return removeResetEffect(state, effect);
  });
  return removed;
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
    if (state.pendingTriggers.some((trigger) => trigger.effectId === effect.id && trigger.sourceUid === effect.sourceUid)) return true;
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

export function cleanupRemovedDuelEffect(state: DuelState, effect: DuelEffectDefinition): void {
  clearEffectCountUsage(state, effect);
  removeCounterPermitCounters(state, effect);
}

function removeResetEffect(state: DuelState, effect: DuelEffectDefinition): false {
  cleanupRemovedDuelEffect(state, effect);
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

function removeCounterPermitCounters(state: DuelState, effect: DuelEffectDefinition): void {
  const code = effect.code ?? 0;
  if ((code & counterEffectMask) !== effectCounterPermit || ((effect.luaTypeFlags ?? 0) & effectTypeSingle) === 0) return;
  const card = state.cards.find((candidate) => candidate.uid === effect.sourceUid);
  if (!card) return;
  const counterType = code & counterTypeMask;
  const count = getDuelCardCounter(card, counterType);
  if (count > 0) removeDuelCardCounter(card, counterType, count);
}
