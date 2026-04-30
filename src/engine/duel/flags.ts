import type { DuelCardInstance, DuelFlagEffect, DuelPhase, DuelState, PlayerId } from "#duel/types.js";

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

const resetEvent = 0x1000;
const resetToGrave = 0x40000;
const resetRemove = 0x80000;
const resetToHand = 0x200000;
const resetToDeck = 0x400000;
const resetLeave = 0x800000;
const resetToField = 0x1000000;
const resetControl = 0x2000000;
const resetOverlay = 0x4000000;
const resetPhase = 0x40000000;
const resetChain = 0x80000000;
const destinationResetFlags = resetToGrave | resetRemove | resetToHand | resetToDeck;
const phaseFlags: Record<DuelPhase, number> = {
  draw: 0x1,
  standby: 0x2,
  main1: 0x4,
  battle: 0x80,
  main2: 0x100,
  end: 0x200,
};

export function pruneDuelFlagEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.flagEffects = state.flagEffects.filter((flag) => {
    if (flag.ownerType !== "card" || flag.ownerId !== card.uid) return true;
    const flags = normalizeResetFlags(flag.reset);
    if ((flags & resetEvent) === 0) return true;
    if ((flags & resetLeave) !== 0 && card.previousLocation !== card.location) return false;
    if (matchesMovementReset(flags, card)) return false;
    if ((flags & destinationResetFlags) !== 0) return !matchesDestinationReset(flags, card);
    const previousLocation = card.previousLocation ?? card.location;
    return previousLocation === card.location;
  });
}

export function pruneDuelFlagEffectsAfterPhase(state: DuelState, phase: DuelPhase): void {
  const phaseFlag = phaseFlags[phase];
  state.flagEffects = state.flagEffects.filter((flag) => {
    const flags = normalizeResetFlags(flag.reset);
    return (flags & resetPhase) === 0 || (flags & phaseFlag) === 0;
  });
}

export function pruneDuelFlagEffectsAfterChain(state: DuelState): void {
  state.flagEffects = state.flagEffects.filter((flag) => (normalizeResetFlags(flag.reset) & resetChain) === 0);
}

function normalizeResetFlags(flags: number): number {
  return flags >>> 0;
}

function matchesMovementReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToField) !== 0 && !isFieldLocation(card.previousLocation) && isFieldLocation(card.location)) return true;
  if ((flags & resetControl) !== 0 && card.previousController !== undefined && card.previousController !== card.controller) return true;
  if ((flags & resetOverlay) !== 0 && card.location === "overlay") return true;
  return false;
}

function isFieldLocation(location: DuelCardInstance["location"] | undefined): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}

function matchesDestinationReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToGrave) !== 0 && card.location === "graveyard") return true;
  if ((flags & resetRemove) !== 0 && card.location === "banished") return true;
  if ((flags & resetToHand) !== 0 && card.location === "hand") return true;
  if ((flags & resetToDeck) !== 0 && (card.location === "deck" || card.location === "extraDeck")) return true;
  return false;
}
