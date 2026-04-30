import type { DuelCardInstance, DuelState } from "#duel/types.js";

const resetEvent = 0x1000;

export function pruneResetEffectsAfterMove(state: DuelState, card: DuelCardInstance): void {
  state.effects = state.effects.filter((effect) => {
    if (effect.sourceUid !== card.uid) return true;
    if ((effect.reset?.flags ?? 0) & resetEvent) {
      const previousLocation = card.previousLocation ?? card.location;
      return !effect.range.includes(previousLocation) || effect.range.includes(card.location);
    }
    return true;
  });
}
