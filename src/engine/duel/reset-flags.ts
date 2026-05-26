import { phaseMask } from "#duel/phase-mask.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelPhase } from "#duel/types.js";

export const resetEvent = 0x1000;
const resetDisable = 0x10000;
export const resetTurnSet = 0x20000;
export const resetLeave = 0x800000;
export const resetPhase = 0x40000000;
export const resetChain = 0x80000000;
export const resetSelfTurn = 0x10000000;
export const resetOppoTurn = 0x20000000;

const resetToGrave = 0x40000;
const resetRemove = 0x80000;
const resetTempRemove = 0x100000;
const resetToHand = 0x200000;
const resetToDeck = 0x400000;
const resetToField = 0x1000000;
const resetControl = 0x2000000;
const resetOverlay = 0x4000000;
const resetMonsterSpellChange = 0x8000000;

export const destinationResetFlags = resetToGrave | resetRemove | resetTempRemove | resetToHand | resetToDeck;

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
  if ((flags & resetMonsterSpellChange) !== 0 && isMonsterSpellZoneChange(card.previousLocation, card.location)) return true;
  return false;
}

export function matchesLeaveReset(flags: number, card: DuelCardInstance): boolean {
  return (flags & resetLeave) !== 0 && card.previousLocation !== card.location && !isTemporaryRemove(card) && !enteredField(card);
}

export function matchesDisableReset(flags: number): boolean {
  return (flags & resetDisable) !== 0;
}

export function matchesTurnSetReset(flags: number, card: DuelCardInstance): boolean {
  return (flags & resetTurnSet) !== 0 && card.previousFaceUp === true && !card.faceUp && card.position === "faceDownDefense";
}

export function matchesDestinationReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToGrave) !== 0 && card.location === "graveyard") return true;
  if ((flags & resetRemove) !== 0 && card.location === "banished" && !isTemporaryRemove(card)) return true;
  if ((flags & resetTempRemove) !== 0 && isTemporaryRemove(card)) return true;
  if ((flags & resetToHand) !== 0 && card.location === "hand") return true;
  if ((flags & resetToDeck) !== 0 && (card.location === "deck" || card.location === "extraDeck")) return true;
  return false;
}

export function matchesTemporaryRemove(card: DuelCardInstance): boolean {
  return isTemporaryRemove(card);
}

export function matchesTurnReset(flags: number, owner: 0 | 1, turnPlayer: 0 | 1): boolean {
  const selfTurn = (flags & resetSelfTurn) !== 0;
  const oppoTurn = (flags & resetOppoTurn) !== 0;
  if (!selfTurn && !oppoTurn) return true;
  return (selfTurn && turnPlayer === owner) || (oppoTurn && turnPlayer !== owner);
}

function isFieldLocation(location: DuelCardInstance["location"] | undefined): boolean {
  return location === "monsterZone" || location === "spellTrapZone" || location === "fieldZone";
}

function enteredField(card: DuelCardInstance): boolean {
  return !isFieldLocation(card.previousLocation) && isFieldLocation(card.location);
}

function isMonsterSpellZoneChange(previous: DuelCardInstance["location"] | undefined, current: DuelCardInstance["location"]): boolean {
  return (previous === "monsterZone" && current === "spellTrapZone") || (previous === "spellTrapZone" && current === "monsterZone");
}

function isTemporaryRemove(card: DuelCardInstance): boolean {
  return card.location === "banished" && ((card.reason ?? 0) & duelReason.temporary) !== 0;
}
