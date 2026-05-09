import { findCard } from "#duel/card-state.js";
import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventCardState, DuelEventName, DuelState, PlayerId, TriggerTiming } from "#duel/types.js";

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
  const firstLink = state.chain[0];
  if (!firstLink || !chainLinkMatchesTriggerEffect(firstLink, effect)) return undefined;
  const eventCard = firstLink.eventCardUid === undefined ? undefined : findCard(state, firstLink.eventCardUid);
  return {
    eventName: firstLink.eventName,
    ...(firstLink.eventCode === undefined ? {} : { eventCode: firstLink.eventCode }),
    ...(firstLink.eventPlayer === undefined ? {} : { eventPlayer: firstLink.eventPlayer }),
    ...(firstLink.eventValue === undefined ? {} : { eventValue: firstLink.eventValue }),
    ...(firstLink.eventReason === undefined ? {} : { eventReason: firstLink.eventReason }),
    ...(firstLink.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: firstLink.eventReasonPlayer }),
    ...(firstLink.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: firstLink.eventReasonCardUid }),
    ...(firstLink.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: firstLink.eventReasonEffectId }),
    ...(firstLink.relatedEffectId === undefined ? {} : { relatedEffectId: firstLink.relatedEffectId }),
    ...(firstLink.eventChainDepth === undefined ? {} : { eventChainDepth: firstLink.eventChainDepth }),
    ...(firstLink.eventChainLinkId === undefined ? {} : { eventChainLinkId: firstLink.eventChainLinkId }),
    ...(firstLink.eventUids === undefined ? {} : { eventUids: [...firstLink.eventUids] }),
    ...(eventCard === undefined ? {} : { eventCard }),
    ...(firstLink.eventPreviousState === undefined ? {} : { eventPreviousState: { ...firstLink.eventPreviousState } }),
    ...(firstLink.eventCurrentState === undefined ? {} : { eventCurrentState: { ...firstLink.eventCurrentState } }),
    ...(firstLink.eventTriggerTiming === undefined ? {} : { eventTriggerTiming: firstLink.eventTriggerTiming }),
  };
}

function chainLinkMatchesTriggerEffect(link: ChainLink, effect: DuelEffectDefinition): link is ChainLink & { eventName: DuelEventName } {
  if (link.eventName !== effect.triggerEvent) return false;
  if (effect.triggerCode === undefined) return true;
  if (link.eventCode === undefined) return link.eventName !== "customEvent";
  if (effect.triggerCode === link.eventCode) return true;
  return link.eventName === "battleDestroyed" && (effect.triggerCode === 1139 || effect.triggerCode === 1140) && (link.eventCode === 1139 || link.eventCode === 1140);
}
