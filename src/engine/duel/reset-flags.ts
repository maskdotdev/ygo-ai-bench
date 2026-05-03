import { phaseMask } from "#duel/phase-mask.js";
import type { DuelCardInstance, DuelPhase } from "#duel/types.js";

export const resetEvent = 0x1000;
export const resetLeave = 0x800000;
export const resetPhase = 0x40000000;
export const resetChain = 0x80000000;

const resetToGrave = 0x40000;
const resetRemove = 0x80000;
const resetToHand = 0x200000;
const resetToDeck = 0x400000;
const resetToField = 0x1000000;
const resetControl = 0x2000000;
const resetOverlay = 0x4000000;

export const destinationResetFlags = resetToGrave | resetRemove | resetToHand | resetToDeck;

export function normalizeResetFlags(flags: number): number {
  return flags >>> 0;
}

export function phaseResetFlag(phase: DuelPhase): number {
  if (phase === "battle") return phaseMask(phase) | 0x8;
  return phaseMask(phase);
}

export function matchesMovementReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToField) !== 0 && !isFieldLocation(card.previousLocation) && isFieldLocation(card.location)) return true;
  if ((flags & resetControl) !== 0 && card.previousController !== undefined && card.previousController !== card.controller) return true;
  if ((flags & resetOverlay) !== 0 && card.location === "overlay") return true;
  return false;
}

export function matchesDestinationReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToGrave) !== 0 && card.location === "graveyard") return true;
  if ((flags & resetRemove) !== 0 && card.location === "banished") return true;
  if ((flags & resetToHand) !== 0 && card.location === "hand") return true;
  if ((flags & resetToDeck) !== 0 && (card.location === "deck" || card.location === "extraDeck")) return true;
  return false;
}

function isFieldLocation(location: DuelCardInstance["location"] | undefined): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}
