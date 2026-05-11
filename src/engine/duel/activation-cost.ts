import { findCard } from "#duel/card-state.js";
import { continuousEffectTargetsPlayer, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export function isActivationCostPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, activatingEffect?: DuelEffectDefinition): boolean {
  return matchingActivationCostEffects(state, player, createContext, card, activatingEffect).some(({ effect, source }) => {
    const ctx = createActivationCostContext(createContext, effect, source, card, player, activatingEffect);
    return !effect.cost?.(ctx);
  });
}

export function applyActivationCosts(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, activatingEffect?: DuelEffectDefinition): void {
  for (const { effect, source } of matchingActivationCostEffects(state, player, createContext, card, activatingEffect)) {
    const checkCtx = createActivationCostContext(createContext, effect, source, card, player, activatingEffect);
    if (effect.cost && !effect.cost(checkCtx)) throw new Error(`Activation cost for ${card.name} could not be paid`);
    const operationCtx = createActivationCostContext(createContext, effect, source, card, player, activatingEffect, false);
    effect.operation?.(operationCtx);
  }
}

function matchingActivationCostEffects(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card: DuelCardInstance, activatingEffect?: DuelEffectDefinition) {
  const matches: { effect: DuelState["effects"][number]; source: DuelCardInstance }[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 90 || !effect.cost) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location) || !continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createActivationCostContext(createContext, effect, source, card, player, activatingEffect);
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    matches.push({ effect, source });
  }
  return matches;
}

function createActivationCostContext(createContext: ContinuousEffectContextFactory, effect: DuelState["effects"][number], source: DuelCardInstance, card: DuelCardInstance, player: PlayerId, activatingEffect?: DuelEffectDefinition, checkOnly = true) {
  const ctx = createContext(effect, source, card, { checkOnly });
  ctx.player = player;
  const relatedEffectId = luaRelatedEffectId(activatingEffect);
  if (relatedEffectId !== undefined) ctx.relatedEffectId = relatedEffectId;
  return ctx;
}

function luaRelatedEffectId(effect: DuelEffectDefinition | undefined): number | undefined {
  const id = Number(effect?.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}
