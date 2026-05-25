import { currentBattleWindowKind } from "#duel/battle-window-state.js";
import { findCard } from "#duel/card-state.js";
import { duelEventCode } from "#duel/event-codes.js";
import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventCardState, DuelEventName, DuelEventRecord, DuelState, PlayerId, TriggerTiming } from "#duel/types.js";

export interface DuelEffectEventContext {
  eventName: DuelEventName;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventCard?: DuelCardInstance;
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
  eventTriggerTiming?: TriggerTiming;
}

export function quickEffectEventContext(state: DuelState, effect: DuelEffectDefinition): DuelEffectEventContext | undefined {
  if (effect.event !== "quick" || effect.triggerEvent === undefined) return undefined;
  if (state.chain.length > 0 && isChainLifecycleEvent(effect.triggerEvent)) return chainQuickEffectEventContext(state, effect);
  const firstLink = state.chain[0];
  if (firstLink) return eventSourceMatchesTriggerEffect(firstLink, effect) ? eventContextFromSource(state, firstLink) : undefined;
  return liveQuickEffectEventContext(state, effect);
}

type DuelEffectEventSource = {
  eventName: DuelEventName;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventCardUid?: string;
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
  eventTriggerTiming?: TriggerTiming;
};

function eventContextFromSource(state: DuelState, source: DuelEffectEventSource): DuelEffectEventContext {
  const eventCard = source.eventCardUid === undefined ? undefined : findCard(state, source.eventCardUid);
  return {
    eventName: source.eventName,
    ...(source.eventCode === undefined ? {} : { eventCode: source.eventCode }),
    ...(source.eventPlayer === undefined ? {} : { eventPlayer: source.eventPlayer }),
    ...(source.eventValue === undefined ? {} : { eventValue: source.eventValue }),
    ...(source.eventReason === undefined ? {} : { eventReason: source.eventReason }),
    ...(source.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: source.eventReasonPlayer }),
    ...(source.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: source.eventReasonCardUid }),
    ...(source.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: source.eventReasonEffectId }),
    ...(source.relatedEffectId === undefined ? {} : { relatedEffectId: source.relatedEffectId }),
    ...(source.eventChainDepth === undefined ? {} : { eventChainDepth: source.eventChainDepth }),
    ...(source.eventChainLinkId === undefined ? {} : { eventChainLinkId: source.eventChainLinkId }),
    ...(source.eventUids === undefined ? {} : { eventUids: [...source.eventUids] }),
    ...(eventCard === undefined ? {} : { eventCard }),
    ...(source.eventPreviousState === undefined ? {} : { eventPreviousState: { ...source.eventPreviousState } }),
    ...(source.eventCurrentState === undefined ? {} : { eventCurrentState: { ...source.eventCurrentState } }),
    ...(source.eventTriggerTiming === undefined ? {} : { eventTriggerTiming: source.eventTriggerTiming }),
  };
}

function chainQuickEffectEventContext(state: DuelState, effect: DuelEffectDefinition): DuelEffectEventContext | undefined {
  const link = state.chain[state.chain.length - 1];
  if (!link || effect.triggerEvent === undefined) return undefined;
  const eventCode = duelEventCode(effect.triggerEvent);
  return eventContextFromSource(state, {
    eventName: effect.triggerEvent,
    ...(eventCode === undefined ? {} : { eventCode }),
    eventPlayer: link.player,
    eventValue: state.chain.length,
    ...(link.eventReason === undefined ? {} : { eventReason: link.eventReason }),
    eventReasonPlayer: link.player,
    ...(link.relatedEffectId === undefined ? {} : { relatedEffectId: link.relatedEffectId }),
    eventChainDepth: state.chain.length,
    eventChainLinkId: link.id,
    eventCardUid: link.sourceUid,
  });
}

function liveQuickEffectEventContext(state: DuelState, effect: DuelEffectDefinition): DuelEffectEventContext | undefined {
  if (!canUseLiveEventHistoryForQuickEffect(state, effect.triggerEvent)) return undefined;
  if (isGenericLatestEventQuickContext(effect.triggerEvent)) {
    const event = latestNonChainLifecycleEvent(state);
    return event && eventSourceMatchesTriggerEffect(event, effect) ? eventContextFromSource(state, event) : undefined;
  }
  const attack = state.pendingBattle ?? state.currentAttack;
  for (let index = state.eventHistory.length - 1; index >= 0; index--) {
    const event = state.eventHistory[index];
    if (!event || !eventSourceMatchesTriggerEffect(event, effect)) continue;
    if (event.eventName === "attackDeclared" && event.eventCardUid !== attack?.attackerUid) continue;
    return eventContextFromSource(state, event);
  }
  return undefined;
}

function canUseLiveEventHistoryForQuickEffect(state: DuelState, eventName: DuelEventName | undefined): boolean {
  if (eventName !== "attackDeclared" && eventName !== "attackDisabled" && eventName !== "battleDestroyed" && !isGenericLatestEventQuickContext(eventName)) return false;
  const kind = currentBattleWindowKind(state);
  if (eventName === "battleDestroyed") return state.phase === "battle" && (kind === "endDamageStep" || kind === undefined);
  if (eventName === "attackDisabled") return state.phase === "battle" && kind === undefined && state.chain.length === 0 && state.pendingTriggers.length === 0;
  if (isGenericLatestEventQuickContext(eventName)) return kind === undefined && state.chain.length === 0 && state.pendingTriggers.length === 0;
  if (!(state.pendingBattle ?? state.currentAttack)) return false;
  return kind === "attackDeclaration" || kind === "attackTargetConfirmation" || kind === "attackNegationResponse";
}

function isGenericLatestEventQuickContext(eventName: DuelEventName | undefined): boolean {
  return eventName === "destroyed" || eventName === "released" || eventName === "specialSummoned";
}

function latestNonChainLifecycleEvent(state: DuelState): DuelEventRecord | undefined {
  for (let index = state.eventHistory.length - 1; index >= 0; index--) {
    const event = state.eventHistory[index];
    if (!event || isChainLifecycleEvent(event.eventName) || isMovementAftermathEvent(event.eventName)) continue;
    return event;
  }
  return undefined;
}

function isChainLifecycleEvent(eventName: DuelEventName): boolean {
  return eventName === "chainActivating" ||
    eventName === "chaining" ||
    eventName === "chainSolving" ||
    eventName === "chainSolved" ||
    eventName === "chainEnded";
}

function isMovementAftermathEvent(eventName: DuelEventName): boolean {
  return eventName === "leftField" || eventName === "moved" || eventName === "sentToGraveyard";
}

function eventSourceMatchesTriggerEffect(source: ChainLink | DuelEventRecord, effect: DuelEffectDefinition): source is (ChainLink | DuelEventRecord) & { eventName: DuelEventName } {
  if (source.eventName !== effect.triggerEvent) return false;
  if (effect.triggerCode === undefined) return true;
  if (source.eventCode === undefined) return source.eventName !== "customEvent";
  if (effect.triggerCode === source.eventCode) return true;
  return source.eventName === "battleDestroyed" && (effect.triggerCode === 1139 || effect.triggerCode === 1140) && (source.eventCode === 1139 || source.eventCode === 1140);
}
