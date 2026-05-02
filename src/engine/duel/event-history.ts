import type { DuelCardInstance, DuelEventName, DuelState } from "#duel/types.js";

export function recordDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  state.eventHistory.push({ eventName, ...(eventCard ? { eventCardUid: eventCard.uid } : {}) });
  state.eventHistory = state.eventHistory.slice(-32);
}
