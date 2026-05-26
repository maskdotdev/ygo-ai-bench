import type { DuelCardInstance, DuelEventCardState, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface DuelEventRecordPayload {
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
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
}

export type DuelEventPayload = DuelEventRecordPayload & {
  eventIsLast?: boolean;
  eventCode?: number;
  triggerEventCode?: number;
};

export function recordDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, eventCode?: number, payload: DuelEventRecordPayload = {}): void {
  state.eventHistory.push({
    eventName,
    ...(eventCode === undefined ? {} : { eventCode }),
    ...eventCardReasonPayload(eventCard),
    ...eventCardStatePayload(eventCard),
    ...payload,
    ...(eventCard ? { eventCardUid: eventCard.uid } : {}),
  });
  state.eventHistory = state.eventHistory.slice(-32);
}

export function eventCardReasonPayload(eventCard?: DuelCardInstance): Pick<DuelEventRecordPayload, "eventReason" | "eventReasonPlayer" | "eventReasonCardUid" | "eventReasonEffectId"> {
  if (!eventCard) return {};
  return {
    ...(eventCard.reason === undefined ? {} : { eventReason: eventCard.reason }),
    ...(eventCard.reasonPlayer === undefined ? {} : { eventReasonPlayer: eventCard.reasonPlayer }),
    ...(eventCard.reasonCardUid === undefined ? {} : { eventReasonCardUid: eventCard.reasonCardUid }),
    ...(eventCard.reasonEffectId === undefined ? {} : { eventReasonEffectId: eventCard.reasonEffectId }),
  };
}

export function eventCardStatePayload(eventCard?: DuelCardInstance): Pick<DuelEventRecordPayload, "eventPreviousState" | "eventCurrentState"> {
  if (!eventCard) return {};
  return {
    eventPreviousState: {
      controller: eventCard.previousController ?? eventCard.controller,
      location: eventCard.previousLocation ?? eventCard.location,
      sequence: eventCard.previousSequence ?? eventCard.sequence,
      position: eventCard.previousPosition ?? eventCard.position,
      faceUp: eventCard.previousFaceUp ?? eventCard.faceUp,
    },
    eventCurrentState: {
      controller: eventCard.controller,
      location: eventCard.location,
      sequence: eventCard.sequence,
      position: eventCard.position,
      faceUp: eventCard.faceUp,
    },
  };
}

export function relatedEffectPayload(effectId: string): Pick<DuelEventRecordPayload, "relatedEffectId"> {
  const relatedEffectId = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(relatedEffectId) ? { relatedEffectId } : {};
}
