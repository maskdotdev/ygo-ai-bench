import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, continuousEffectTargetsPlayer } from "#duel/continuous-effects.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import type { ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function isSpecialSummonCostPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, summonTypeCode?: number): boolean {
  for (const { effect, source } of matchingSpecialSummonCostEffects(state, player, createContext, card, summonTypeCode)) {
    const ctx = createSpecialSummonCostContext(createContext, effect, source, card, player, summonTypeCode);
    if (!effect.cost?.(ctx)) return true;
  }
  return false;
}

export function applySpecialSummonCosts(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, summonTypeCode?: number): void {
  for (const { effect, source } of matchingSpecialSummonCostEffects(state, player, createContext, card, summonTypeCode)) {
    const checkCtx = createSpecialSummonCostContext(createContext, effect, source, card, player, summonTypeCode);
    if (effect.cost && !effect.cost(checkCtx)) throw new Error(`Special Summon cost for ${card.name} could not be paid`);
    const operationCtx = createSpecialSummonCostContext(createContext, effect, source, card, player, summonTypeCode, false);
    effect.operation?.(operationCtx);
  }
}

function matchingSpecialSummonCostEffects(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, summonTypeCode?: number) {
  const matches: { effect: DuelState["effects"][number]; source: DuelCardInstance }[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 92 || !effect.cost) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createSpecialSummonCostContext(createContext, effect, source, card, player, summonTypeCode);
    if (!continuousEffectTargetsPlayer(effect, source, player) && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    matches.push({ effect, source });
  }
  return matches;
}

function createSpecialSummonCostContext(createContext: ContinuousEffectContextFactory, effect: DuelState["effects"][number], source: DuelCardInstance, card: DuelCardInstance, player: PlayerId, summonTypeCode?: number, checkOnly = true) {
  const ctx = createContext(effect, source, card, { checkOnly });
  ctx.summonTypeCode = effectiveSpecialSummonTypeCode(summonTypeCode);
  ctx.player = player;
  return ctx;
}
