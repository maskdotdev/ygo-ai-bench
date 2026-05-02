import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface DuelEventRecordPayload {
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  relatedEffectId?: number;
}

export function recordDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, eventCode?: number, payload: DuelEventRecordPayload = {}): void {
  state.eventHistory.push({ eventName, ...(eventCode === undefined ? {} : { eventCode }), ...payload, ...(eventCard ? { eventCardUid: eventCard.uid } : {}) });
  state.eventHistory = state.eventHistory.slice(-32);
}
