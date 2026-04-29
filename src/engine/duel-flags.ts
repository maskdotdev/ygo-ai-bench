import type { DuelFlagEffect, DuelState, PlayerId } from "./duel-types.js";

export type DuelFlagOwner = { ownerType: "player"; ownerId: PlayerId } | { ownerType: "card"; ownerId: string };

export function registerDuelFlagEffect(state: DuelState, owner: DuelFlagOwner, code: number, reset: number, property: number, value: number): DuelFlagEffect {
  const flag: DuelFlagEffect = {
    ownerType: owner.ownerType,
    ownerId: String(owner.ownerId),
    code,
    reset,
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

export function resetDuelFlagEffect(state: DuelState, owner: DuelFlagOwner, code: number): number {
  const before = state.flagEffects.length;
  state.flagEffects = state.flagEffects.filter((flag) => flag.ownerType !== owner.ownerType || flag.ownerId !== String(owner.ownerId) || flag.code !== code);
  return before - state.flagEffects.length;
}
