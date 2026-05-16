import { findCard } from "#duel/card-state.js";
import { continuousEffectSourceIsActive } from "#duel/continuous-effects.js";
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
      .map((effect) => ({ effect, source: findCard(state, effect.sourceUid) }))
      .find(({ effect, source }) => {
        if (effect.event !== "continuous" || effect.code !== 141 || !source || skipped.has(source.uid)) return false;
        if (!effect.range.includes(source.location) || !continuousEffectSourceIsActive(effect, source)) return false;
        if (!canUseEffectCount(state, effect)) return false;
        const ctx = createEffectContext(state, source, effect.controller, "adjust");
        return !effect.canActivate || effect.canActivate(ctx);
      });
    if (!match?.source) return;
    const beforeLocation = match.source.location;
    const beforeController = match.source.controller;
    const effectId = luaEffectNumericId(match.effect);
    const destroyed = destroyCard(
      state,
      match.source.uid,
      match.source.controller,
      duelReason.effect | duelReason.destroy,
      match.effect.controller,
      "graveyard",
      { eventReasonCardUid: match.source.uid, ...(effectId === undefined ? {} : { eventReasonEffectId: effectId }) },
    );
    markEffectUsed(state, match.effect);
    if (destroyed.location === beforeLocation && destroyed.controller === beforeController) skipped.add(match.source.uid);
  }
}

function luaEffectNumericId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}
