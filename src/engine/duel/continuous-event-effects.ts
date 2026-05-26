import { findCard } from "#duel/card-state.js";
import { continuousEffectSourceIsActive } from "#duel/continuous-effects.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { createEffectContext } from "#duel/effect-context.js";
import { cleanupRemovedDuelEffect } from "#duel/effect-reset.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventName, DuelState } from "#duel/types.js";

export function executeNonChainSolvingContinuousEventEffects(state: DuelState, eventName: DuelEventName, eventCode: number, eventCards: DuelCardInstance[], payload: DuelEventPayload, chainLink?: ChainLink): void {
  if (eventName === "chainSolving") return;
  executeContinuousEventEffects(state, eventName, eventCode, eventCards, payload, chainLink);
}

export function executeContinuousEventEffects(state: DuelState, eventName: DuelEventName, eventCode: number, eventCards: DuelCardInstance[], payload: DuelEventPayload, chainLink?: ChainLink): void {
  for (const effect of [...state.effects]) {
    if (effect.event !== "continuous" || !continuousEventCodeMatches(effect, eventName, eventCode) || !canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !continuousEventSourceInRange(effect, source, eventName) || !continuousEffectSourceIsActive(effect, source)) continue;
    if (eventName === "leftField" && source.code === "50078509" && ((payload.eventReason ?? eventCards[0]?.reason ?? 0) & duelReason.destroy) === 0) continue;
    const sourceOnly = isSourceOnlyContinuousEventEffect(effect);
    const eventCard = battleDestroyingContinuousEventCard(state, effect, eventName, eventCards, source) ?? (sourceOnly ? eventCards.find((card) => card.uid === source.uid) : eventCards[0]);
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
    if (effect.labelObjectId !== undefined) ctx.effectLabelObjectId = effect.labelObjectId;
    if (effect.labelObjectUid !== undefined) ctx.effectLabelObjectUid = effect.labelObjectUid;
    if (effect.labelObjectUids !== undefined) ctx.effectLabelObjectUids = [...effect.labelObjectUids];
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    effect.operation(ctx);
    markEffectUsed(state, effect);
    removeResolvedSourceOnlyLeaveFieldEffect(state, effect, source, eventName);
  }
}

function isSourceOnlyContinuousEventEffect(effect: DuelEffectDefinition): boolean {
  return ((effect.luaTypeFlags ?? 0) & 0x1) !== 0;
}

function continuousEventSourceInRange(effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName): boolean {
  if (effect.range.includes(source.location)) return true;
  return (
    eventName === "leftField" &&
    isSourceOnlyContinuousEventEffect(effect) &&
    source.previousLocation !== undefined &&
    effect.range.includes(source.previousLocation)
  );
}

function removeResolvedSourceOnlyLeaveFieldEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName): void {
  if (eventName !== "leftField" || !isSourceOnlyContinuousEventEffect(effect) || effect.range.includes(source.location)) return;
  cleanupRemovedDuelEffect(state, effect);
  state.effects = state.effects.filter((candidate) => candidate !== effect);
}

function battleDestroyingContinuousEventCard(
  state: DuelState,
  effect: DuelEffectDefinition,
  eventName: DuelEventName,
  eventCards: DuelCardInstance[],
  source: DuelCardInstance,
): DuelCardInstance | undefined {
  if (eventName !== "battleDestroyed" || effect.code !== 1139) return undefined;
  const destroyingUid = eventCards.map((card) => battleDestroyingSourceUid(state, card)).find((uid) => uid === source.uid);
  return destroyingUid === source.uid ? source : undefined;
}

function battleDestroyingSourceUid(state: DuelState, eventCard: DuelCardInstance): string | undefined {
  const attack = state.currentAttack ?? state.pendingBattle;
  if (!attack) return undefined;
  if (eventCard.uid === attack.attackerUid) return attack.targetUid;
  if (eventCard.uid === attack.targetUid) return attack.attackerUid;
  return undefined;
}

function continuousEventCodeMatches(effect: DuelEffectDefinition, eventName: DuelEventName, eventCode: number): boolean {
  if (effect.code === eventCode) return true;
  if (eventName === "leftField" && (effect.code === 1015 || effect.code === 1019) && (eventCode === 1015 || eventCode === 1019)) return true;
  if (eventName === "flipSummoned" && (effect.code === 1001 || effect.code === 1101) && (eventCode === 1001 || eventCode === 1101)) return true;
  return eventName === "battleDestroyed" && (effect.code === 1139 || effect.code === 1140) && (eventCode === 1139 || eventCode === 1140);
}
