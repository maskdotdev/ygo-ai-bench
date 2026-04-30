import { clearEffectCountUsage } from "#duel/effect-counts.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelPhase, DuelState } from "#duel/types.js";

const resetEvent = 0x1000;
const resetToGrave = 0x40000;
const resetRemove = 0x80000;
const resetToHand = 0x200000;
const resetToDeck = 0x400000;
const resetLeave = 0x800000;
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

export function pruneResetEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    const flags = normalizeResetFlags(effect.reset?.flags ?? 0);
    if ((flags & resetEvent) === 0) return true;
    if ((flags & resetLeave) !== 0 && card.previousLocation !== card.location) return removeResetEffect(state, effect);
    if ((flags & destinationResetFlags) !== 0) return matchesDestinationReset(flags, card) ? removeResetEffect(state, effect) : true;
    const previousLocation = card.previousLocation ?? card.location;
    return !effect.range.includes(previousLocation) || effect.range.includes(card.location) || removeResetEffect(state, effect);
  });
}

export function pruneResetEffectsAfterPhase(state: DuelState, phase: DuelPhase): void {
  const phaseFlag = phaseFlags[phase];
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

function normalizeResetFlags(flags: number): number {
  return flags >>> 0;
}

function removeResetEffect(state: DuelState, effect: DuelEffectDefinition): false {
  clearEffectCountUsage(state, effect);
  return false;
}

function matchesDestinationReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToGrave) !== 0 && card.location === "graveyard") return true;
  if ((flags & resetRemove) !== 0 && card.location === "banished") return true;
  if ((flags & resetToHand) !== 0 && card.location === "hand") return true;
  if ((flags & resetToDeck) !== 0 && (card.location === "deck" || card.location === "extraDeck")) return true;
  return false;
}
