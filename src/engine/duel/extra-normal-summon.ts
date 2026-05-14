import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, continuousEffectTargetsPlayer } from "#duel/continuous-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

const effectSetSummonCountLimit = 28;
const effectExtraSummonCount = 29;

export function hasNormalSummonCountAvailable(state: DuelState, player: PlayerId, card: DuelCardInstance): boolean {
  if (state.activityCounts[player].normalSummon < normalSummonCountLimit(state, player, card)) return true;
  if (state.players[player].normalSummonAvailable && state.activityCounts[player].normalSummon === 0) return true;
  return false;
}

export function hasAdditionalNormalSummonCountAvailable(state: DuelState, player: PlayerId): boolean {
  return state.activityCounts[player].normalSummon < playerNormalSummonCountLimit(state, player);
}

export function hasActiveExtraNormalSummonCountEffect(state: DuelState, player: PlayerId): boolean {
  return state.effects.some((effect) => {
    if (effect.event !== "continuous" || effect.code !== effectExtraSummonCount || effect.controller !== player) return false;
    const source = findCard(state, effect.sourceUid);
    return Boolean(source && effect.range.includes(source.location));
  });
}

function normalSummonCountLimit(state: DuelState, player: PlayerId, card: DuelCardInstance): number {
  return Math.max(playerNormalSummonCountLimit(state, player), 1 + extraNormalSummonCount(state, player, card));
}

function playerNormalSummonCountLimit(state: DuelState, player: PlayerId): number {
  let limit = 1;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== effectSetSummonCountLimit) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createEffectContext(state, source, effect.controller, undefined, undefined, [], true);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    const value = effect.value ?? effect.statValue?.(ctx, source);
    if (typeof value === "number" && Number.isFinite(value)) limit = Math.max(limit, value);
  }
  return limit;
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
