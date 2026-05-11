import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, continuousEffectTargetsPlayer, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function isSummonOrSetCostPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, codes: readonly number[]): boolean {
  for (const { effect, source } of matchingSummonOrSetCostEffects(state, player, createContext, card, codes)) {
    const ctx = createContext(effect, source, card);
    ctx.player = player;
    if (!effect.cost?.(ctx)) return true;
  }
  return false;
}

export function applySummonOrSetCosts(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, codes: readonly number[]): void {
  for (const { effect, source } of matchingSummonOrSetCostEffects(state, player, createContext, card, codes)) {
    const checkCtx = createContext(effect, source, card);
    checkCtx.player = player;
    if (effect.cost && !effect.cost(checkCtx)) throw new Error(`Cost for ${card.name} could not be paid`);
    const operationCtx = createContext(effect, source, card, { checkOnly: false });
    operationCtx.player = player;
    effect.operation?.(operationCtx);
  }
}

function matchingSummonOrSetCostEffects(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, codes: readonly number[]) {
  const matches: { effect: DuelState["effects"][number]; source: DuelCardInstance }[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !codes.includes(effect.code ?? -1) || !effect.cost) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    ctx.player = player;
    if (!continuousEffectTargetsPlayer(effect, source, player) && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    matches.push({ effect, source });
  }
  return matches;
}
