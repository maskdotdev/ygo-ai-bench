import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, continuousEffectSourceIsActive } from "#duel/continuous-effects.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

type DestroyCard = (
  state: DuelState,
  uid: string,
  controller?: PlayerId,
  reason?: number,
  reasonPlayer?: PlayerId,
  destination?: DuelLocation,
  payload?: { eventReasonCardUid?: string; eventReasonEffectId?: number },
) => DuelCardInstance;

export function applyContinuousSelfDestroyEffects(state: DuelState, destroyCard: DestroyCard): void {
  const skipped = new Set<string>();
  let guard = 0;
  while (guard++ < 20) {
    const match = state.effects
      .flatMap((effect) => {
        const source = findCard(state, effect.sourceUid);
        if (!source) return [];
        return state.cards.map((card) => ({ effect, source, card }));
      })
      .find(({ effect, source, card }) => {
        if (effect.event !== "continuous" || effect.code !== 141) return false;
        if (!effect.range.includes(source.location) || !continuousEffectSourceIsActive(effect, source)) return false;
        if (!canUseEffectCount(state, effect)) return false;
        if (skipped.has(card.uid)) return false;
        const ctx = createEffectContext(state, source, effect.controller, "adjust", card);
        if (!continuousEffectAppliesToCard(effect, source, card, ctx)) return false;
        return !effect.canActivate || effect.canActivate(ctx);
      });
    if (!match) return;
    const beforeLocation = match.card.location;
    const beforeController = match.card.controller;
    const effectId = luaEffectNumericId(match.effect);
    const destroyed = destroyCard(
      state,
      match.card.uid,
      match.card.controller,
      duelReason.effect | duelReason.destroy,
      match.effect.controller,
      "graveyard",
      { eventReasonCardUid: match.source.uid, ...(effectId === undefined ? {} : { eventReasonEffectId: effectId }) },
    );
    markEffectUsed(state, match.effect);
    if (destroyed.location === beforeLocation && destroyed.controller === beforeController) skipped.add(match.card.uid);
  }
}

function luaEffectNumericId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}
