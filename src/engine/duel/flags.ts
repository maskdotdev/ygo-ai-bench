import {
  destinationResetFlags,
  matchesDestinationReset,
  matchesMovementReset,
  matchesTurnReset,
  normalizeResetFlags,
  phaseResetFlag,
  resetChain,
  resetEvent,
  resetLeave,
  resetPhase,
} from "#duel/reset-flags.js";
import type { DuelCardInstance, DuelFlagEffect, DuelPhase, DuelState, PlayerId } from "#duel/types.js";

export type DuelFlagOwner = { ownerType: "player"; ownerId: PlayerId } | { ownerType: "card"; ownerId: string };

export function registerDuelFlagEffect(state: DuelState, owner: DuelFlagOwner, code: number, reset: number, property: number, value: number, resetCount?: number): DuelFlagEffect {
  const flag: DuelFlagEffect = {
    ownerType: owner.ownerType,
    ownerId: String(owner.ownerId),
    code,
    reset,
    ...(resetCount === undefined ? {} : { resetCount }),
    property,
    value,
    turn: state.turn,
  };
  state.flagEffects.push(flag);
  return flag;
}

export function getDuelFlagEffectCount(state: DuelState, owner: DuelFlagOwner, code: number): number {
  return state.flagEffects.filter((flag) => flag.ownerType === owner.ownerType && flag.ownerId === String(owner.ownerId) && flag.code === code).length;
}

export function getDuelFlagEffectLabel(state: DuelState, owner: DuelFlagOwner, code: number): number {
  return state.flagEffects.find((flag) => flag.ownerType === owner.ownerType && flag.ownerId === String(owner.ownerId) && flag.code === code)?.value ?? 0;
}

export function setDuelFlagEffectLabel(state: DuelState, owner: DuelFlagOwner, code: number, value: number): number {
  const flag = state.flagEffects.find((candidate) => candidate.ownerType === owner.ownerType && candidate.ownerId === String(owner.ownerId) && candidate.code === code);
  if (!flag) return 0;
  flag.value = value;
  return 1;
}

export function resetDuelFlagEffect(state: DuelState, owner: DuelFlagOwner, code: number): number {
  const before = state.flagEffects.length;
  state.flagEffects = state.flagEffects.filter((flag) => flag.ownerType !== owner.ownerType || flag.ownerId !== String(owner.ownerId) || flag.code !== code);
  return before - state.flagEffects.length;
}

export function pruneDuelFlagEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.flagEffects = state.flagEffects.filter((flag) => {
    if (flag.ownerType !== "card" || flag.ownerId !== card.uid) return true;
    const flags = normalizeResetFlags(flag.reset);
    if ((flags & resetEvent) === 0) return true;
    if ((flags & resetLeave) !== 0 && card.previousLocation !== card.location) return decrementFlagResetCount(flag);
    if (matchesMovementReset(flags, card)) return decrementFlagResetCount(flag);
    if ((flags & destinationResetFlags) !== 0) return matchesDestinationReset(flags, card) ? decrementFlagResetCount(flag) : true;
    const previousLocation = card.previousLocation ?? card.location;
    return previousLocation === card.location || decrementFlagResetCount(flag);
  });
}

export function pruneDuelFlagEffectsAfterPhase(state: DuelState, phase: DuelPhase): void {
  pruneDuelFlagEffectsAfterPhaseFlag(state, phaseResetFlag(phase));
}

export function pruneDuelFlagEffectsAfterPhaseFlag(state: DuelState, phaseFlag: number): void {
  state.flagEffects = state.flagEffects.filter((flag) => {
    const flags = normalizeResetFlags(flag.reset);
    if ((flags & resetPhase) === 0 || (flags & phaseFlag) === 0) return true;
    const owner = flagTurnOwner(state, flag);
    if (owner !== undefined && !matchesTurnReset(flags, owner, state.turnPlayer)) return true;
    return decrementFlagResetCount(flag);
  });
}

export function pruneDuelFlagEffectsAfterChain(state: DuelState): void {
  state.flagEffects = state.flagEffects.filter((flag) => (normalizeResetFlags(flag.reset) & resetChain) === 0 || decrementFlagResetCount(flag));
}

function decrementFlagResetCount(flag: DuelFlagEffect): boolean {
  if (flag.resetCount !== undefined && flag.resetCount > 1) {
    flag.resetCount -= 1;
    return true;
  }
  return false;
}

function flagTurnOwner(state: DuelState, flag: DuelFlagEffect): PlayerId | undefined {
  if (flag.ownerType === "player") return flag.ownerId === "1" ? 1 : 0;
  return state.cards.find((card) => card.uid === flag.ownerId)?.controller;
}
