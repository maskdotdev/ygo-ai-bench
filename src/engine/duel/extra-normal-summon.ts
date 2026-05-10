import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard } from "#duel/continuous-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

const effectExtraSummonCount = 29;

export function hasNormalSummonCountAvailable(state: DuelState, player: PlayerId, card: DuelCardInstance): boolean {
  if (state.players[player].normalSummonAvailable) return true;
  const extra = extraNormalSummonCount(state, player, card);
  return extra > 0 && state.activityCounts[player].normalSummon < 1 + extra;
}

function extraNormalSummonCount(state: DuelState, player: PlayerId, card: DuelCardInstance): number {
  let count = 0;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== effectExtraSummonCount || effect.controller !== player) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createEffectContext(state, source, effect.controller, undefined, card, [], true);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) count += 1;
  }
  return count;
}
