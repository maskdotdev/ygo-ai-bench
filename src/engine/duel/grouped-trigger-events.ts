import { duelEventCode } from "#duel/event-codes.js";
import { eventCardReasonPayload, recordDuelEvent, type DuelEventPayload } from "#duel/event-history.js";
import { collectGroupedTriggerEffects, collectTriggerEffects, type DuelTriggerCollectOptions } from "#duel/triggers.js";
import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventName, DuelState } from "#duel/types.js";

type GroupedTriggerChooser = (
  state: DuelState,
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  eventName: DuelEventName,
  eventCard: DuelCardInstance | undefined,
  payload: DuelEventPayload,
) => boolean;

type ContinuousEventExecutor = (
  state: DuelState,
  eventName: DuelEventName,
  eventCode: number,
  eventCards: DuelCardInstance[],
  payload: DuelEventPayload,
  chainLink?: ChainLink,
) => void;

export function collectDuelGroupedTriggerEffectsWithChooser(
  state: DuelState,
  eventName: DuelEventName,
  eventCards: DuelCardInstance[],
  options: DuelEventPayload,
  canChooseEffect: GroupedTriggerChooser,
  executeContinuousEvent?: ContinuousEventExecutor,
  continuousChainLink?: ChainLink,
): void {
  const uniqueEventCards = uniqueCards(eventCards);
  const eventCard = uniqueEventCards[0];
  const eventUids = uniqueEventCards.length > 1 ? uniqueEventCards.map((card) => card.uid) : options.eventUids;
  const groupedOptions = eventUids && eventUids.length > 0 ? { ...options, eventUids } : options;
  const eventOptions = eventName === "usedAsMaterial" && eventCard ? { ...eventCardReasonPayload(eventCard), ...groupedOptions } : groupedOptions;
  const eventCode = eventOptions.eventCode ?? duelEventCode(eventName);
  const triggerCode = eventOptions.triggerEventCode ?? eventCode;
  const triggerOptions = triggerCode === undefined ? eventOptions : { ...eventOptions, eventCode: triggerCode };
  recordDuelEvent(state, eventName, eventCard, eventCode, eventRecordPayload(eventCard, groupedOptions));
  if (triggerCode !== undefined) executeContinuousEvent?.(state, eventName, triggerCode, uniqueEventCards, triggerOptions, continuousChainLink);
  const chooser = (
    duel: DuelState,
    effect: DuelEffectDefinition,
    source: DuelCardInstance,
    triggerEventName: DuelEventName,
    triggerEventCard?: DuelCardInstance,
    triggerPayload: DuelTriggerCollectOptions = triggerOptions,
  ) => canChooseEffect(duel, effect, source, triggerEventName, triggerEventCard, triggerPayload);
  if (uniqueEventCards.length <= 1) collectTriggerEffects(state, eventName, chooser, eventCard, triggerOptions);
  else collectGroupedTriggerEffects(state, eventName, chooser, uniqueEventCards, triggerOptions);
}

function uniqueCards(cards: DuelCardInstance[]): DuelCardInstance[] {
  const seen = new Set<string>();
  const result: DuelCardInstance[] = [];
  for (const card of cards) {
    if (seen.has(card.uid)) continue;
    seen.add(card.uid);
    result.push(card);
  }
  return result;
}

function eventRecordPayload(eventCard: DuelCardInstance | undefined, options: DuelEventPayload): Parameters<typeof recordDuelEvent>[4] {
  return {
    ...eventCardReasonPayload(eventCard),
    ...(options.eventPlayer === undefined ? {} : { eventPlayer: options.eventPlayer }),
    ...(options.eventValue === undefined ? {} : { eventValue: options.eventValue }),
    ...(options.eventReason === undefined ? {} : { eventReason: options.eventReason }),
    ...(options.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: options.eventReasonPlayer }),
    ...(options.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: options.eventReasonCardUid }),
    ...(options.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: options.eventReasonEffectId }),
    ...(options.relatedEffectId === undefined ? {} : { relatedEffectId: options.relatedEffectId }),
    ...(options.eventChainDepth === undefined ? {} : { eventChainDepth: options.eventChainDepth }),
    ...(options.eventChainLinkId === undefined ? {} : { eventChainLinkId: options.eventChainLinkId }),
    ...(options.eventUids === undefined || options.eventUids.length === 0 ? {} : { eventUids: [...options.eventUids] }),
    ...(options.eventPreviousState === undefined ? {} : { eventPreviousState: { ...options.eventPreviousState } }),
    ...(options.eventCurrentState === undefined ? {} : { eventCurrentState: { ...options.eventCurrentState } }),
  };
}
