import type { DuelCardInstance, DuelState } from "#duel/types.js";

const resetEvent = 0x1000;
const resetToGrave = 0x40000;
const resetRemove = 0x80000;
const resetToHand = 0x200000;
const resetToDeck = 0x400000;
const resetLeave = 0x800000;
const destinationResetFlags = resetToGrave | resetRemove | resetToHand | resetToDeck;

export function pruneResetEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    const flags = effect.reset?.flags ?? 0;
    if ((flags & resetEvent) === 0) return true;
    if ((flags & resetLeave) !== 0 && card.previousLocation !== card.location) return false;
    if ((flags & destinationResetFlags) !== 0) return !matchesDestinationReset(flags, card);
    const previousLocation = card.previousLocation ?? card.location;
    return !effect.range.includes(previousLocation) || effect.range.includes(card.location);
  });
}

function matchesDestinationReset(flags: number, card: DuelCardInstance): boolean {
  if ((flags & resetToGrave) !== 0 && card.location === "graveyard") return true;
  if ((flags & resetRemove) !== 0 && card.location === "banished") return true;
  if ((flags & resetToHand) !== 0 && card.location === "hand") return true;
  if ((flags & resetToDeck) !== 0 && (card.location === "deck" || card.location === "extraDeck")) return true;
  return false;
}
