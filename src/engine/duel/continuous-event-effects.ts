import { findCard } from "#duel/card-state.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventName, DuelState } from "#duel/types.js";

export function executeNonChainSolvingContinuousEventEffects(state: DuelState, eventName: DuelEventName, eventCode: number, eventCards: DuelCardInstance[], payload: DuelEventPayload, chainLink?: ChainLink): void {
  if (eventName === "chainSolving") return;
  executeContinuousEventEffects(state, eventName, eventCode, eventCards, payload, chainLink);
}

export function executeContinuousEventEffects(state: DuelState, eventName: DuelEventName, eventCode: number, eventCards: DuelCardInstance[], payload: DuelEventPayload, chainLink?: ChainLink): void {
  for (const effect of [...state.effects]) {
    if (effect.event !== "continuous" || effect.code !== eventCode || !canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const sourceOnly = isSourceOnlyContinuousEventEffect(effect);
    const eventCard = sourceOnly ? eventCards.find((card) => card.uid === source.uid) : eventCards[0];
    if (sourceOnly && !eventCard) continue;
    const ctx = createEffectContext(
      state,
      source,
      effect.controller,
      eventName,
      eventCard,
      [],
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      chainLink,
      eventCode,
      payload.eventPlayer,
      payload.eventValue,
      payload.eventReason,
      payload.eventReasonPlayer,
      payload.eventReasonCardUid,
      payload.eventReasonEffectId,
      payload.relatedEffectId,
      payload.eventChainDepth,
      payload.eventChainLinkId,
      payload.eventUids,
    );
    if (effect.labelObjectUid !== undefined) ctx.effectLabelObjectUid = effect.labelObjectUid;
    if (effect.labelObjectUids !== undefined) ctx.effectLabelObjectUids = [...effect.labelObjectUids];
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    effect.operation(ctx);
    markEffectUsed(state, effect);
  }
}

function isSourceOnlyContinuousEventEffect(effect: DuelEffectDefinition): boolean {
  return ((effect.luaTypeFlags ?? 0) & 0x1) !== 0;
}
