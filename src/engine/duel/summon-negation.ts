import { findCard, moveDuelCard } from "#duel/card-state.js";
import { isSummonNegationPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEventName, DuelState } from "#duel/types.js";

export interface DuelSummonNegationHandlers {
  createContinuousContext(state: DuelState): ContinuousEffectContextFactory;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
}

export function negateCoreDuelSummon(state: DuelState, uid: string, handlers: DuelSummonNegationHandlers): DuelCardInstance | undefined {
  const card = findCard(state, uid);
  if (!card || card.location !== "monsterZone" || card.summonType === undefined) return undefined;
  if (isSummonNegationPrevented(state, card, card.summonType, handlers.createContinuousContext(state))) return undefined;
  const eventName = summonNegatedEventName(card);
  scrubSummonSuccessForNegatedCard(state, card);
  moveDuelCard(state, card.uid, "graveyard", card.controller, duelReason.disSummon, state.turnPlayer);
  delete card.summonType;
  delete card.summonPlayer;
  handlers.collectEvent(state, eventName, card);
  return card;
}

function scrubSummonSuccessForNegatedCard(state: DuelState, card: DuelCardInstance): void {
  const successEvent = summonSuccessEventName(card);
  state.pendingTriggers = state.pendingTriggers.filter((trigger) => trigger.eventName !== successEvent || trigger.eventCardUid !== card.uid);
  state.eventHistory = state.eventHistory.filter((event) => event.eventName !== successEvent || event.eventCardUid !== card.uid);
}

function summonSuccessEventName(card: DuelCardInstance): "normalSummoned" | "flipSummoned" | "specialSummoned" {
  if (card.summonType === "normal" || card.summonType === "tribute") return "normalSummoned";
  if (card.summonType === "flip") return "flipSummoned";
  return "specialSummoned";
}

function summonNegatedEventName(card: DuelCardInstance): "normalSummonNegated" | "flipSummonNegated" | "specialSummonNegated" {
  if (card.summonType === "normal" || card.summonType === "tribute") return "normalSummonNegated";
  if (card.summonType === "flip") return "flipSummonNegated";
  return "specialSummonNegated";
}
