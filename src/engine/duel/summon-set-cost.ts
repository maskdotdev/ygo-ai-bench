import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, continuousEffectTargetsPlayer, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function isSummonOrSetCostPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, codes: readonly number[]): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !codes.includes(effect.code ?? -1) || !effect.cost) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    ctx.player = player;
    if (!continuousEffectTargetsPlayer(effect, source, player) && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    if (!effect.cost(ctx)) return true;
  }
  return false;
}
