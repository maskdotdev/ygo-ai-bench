import { findCard } from "#duel/card-state.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import type { ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function isSpecialSummonCostPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, summonTypeCode?: number): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 92 || effect.sourceUid !== card.uid || !effect.cost) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    ctx.summonTypeCode = effectiveSpecialSummonTypeCode(summonTypeCode);
    ctx.player = player;
    if (!effect.cost(ctx)) return true;
  }
  return false;
}
