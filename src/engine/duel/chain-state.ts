import { findCard } from "#duel/card-state.js";
import type { DuelState } from "#duel/types.js";

export function chainLinksResolvable(state: DuelState): boolean {
  return state.chain.every((link) => {
    const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
    return Boolean(effect && findCard(state, link.sourceUid));
  });
}
