import { findCard, moveDuelCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { eventCardReasonPayload, eventCardStatePayload } from "#duel/event-history.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventCardState, DuelEventName, DuelState, PendingTrigger, PlayerId, TriggerBucket } from "#duel/types.js";

export type DuelTriggerChooser = (
  state: DuelState,
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  eventName: DuelEventName,
  eventCard?: DuelCardInstance,
  options?: DuelTriggerCollectOptions,
) => boolean;

export interface DuelTriggerCollectOptions {
  eventIsLast?: boolean;
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
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
}

interface TriggerEventCandidate {
  eventCard?: DuelCardInstance | undefined;
  options: DuelTriggerCollectOptions;
}

export function collectTriggerEffects(state: DuelState, eventName: DuelEventName, canChooseEffect: DuelTriggerChooser, eventCard?: DuelCardInstance, options: DuelTriggerCollectOptions = {}): void {
  const collected: Array<{ effect: DuelEffectDefinition; source: DuelCardInstance; index: number; eventCard?: DuelCardInstance | undefined; options: DuelTriggerCollectOptions }> = [];
  const eventIsLast = options.eventIsLast ?? true;
  for (const [index, effect] of state.effects.entries()) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (effect.triggerCode !== undefined && options.eventCode !== undefined && !triggerCodeMatchesEvent(eventName, effect.triggerCode, options.eventCode)) continue;
    if (eventName === "customEvent" && effect.triggerCode !== options.eventCode) continue;
    if (effect.optional !== false && effect.triggerTiming === "when" && !eventIsLast) continue;
    if (!canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source) continue;
    const candidate = triggerEventCandidate(state, effect, eventName, eventCard, options);
    if (isBattleDestroyingSingleTrigger(effect, eventName) && candidate.eventCard?.uid !== source.uid) continue;
    if (effect.triggerSourceOnly && candidate.eventCard?.uid !== source.uid) continue;
    if (!triggerSourceInRange(effect, source, eventName, candidate.eventCard)) continue;
    if (isTriggerPrevented(state, source)) continue;
    if (!shouldDeferCustomEventChoice(state, eventName) && !canChooseEffect(state, effect, source, eventName, candidate.eventCard, candidate.options)) continue;
    collected.push({ effect, source, index, eventCard: candidate.eventCard, options: triggerMatchedOptions(effect, candidate.options) });
  }
  collected.sort((a, b) => triggerPriority(state, a.effect) - triggerPriority(state, b.effect) || a.index - b.index);
  for (const trigger of collected) state.pendingTriggers.push(createPendingTrigger(state, trigger.effect, trigger.source, eventName, trigger.eventCard, trigger.options));
  setWaitingForPendingTriggerBucket(state);
}

export function collectGroupedTriggerEffects(state: DuelState, eventName: DuelEventName, canChooseEffect: DuelTriggerChooser, eventCards: DuelCardInstance[], options: DuelTriggerCollectOptions = {}): void {
  const uniqueEventCards = uniqueCards(eventCards);
  if (uniqueEventCards.length <= 1) {
    collectTriggerEffects(state, eventName, canChooseEffect, uniqueEventCards[0], options);
    return;
  }
  const eventUids = options.eventUids && options.eventUids.length > 0 ? options.eventUids : uniqueEventCards.map((card) => card.uid);
  const groupedOptions = { ...options, eventUids };
  const collected: Array<{ effect: DuelEffectDefinition; source: DuelCardInstance; index: number; eventCard?: DuelCardInstance | undefined; options: DuelTriggerCollectOptions }> = [];
  const eventIsLast = groupedOptions.eventIsLast ?? true;
  for (const [index, effect] of state.effects.entries()) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (effect.triggerCode !== undefined && groupedOptions.eventCode !== undefined && !triggerCodeMatchesEvent(eventName, effect.triggerCode, groupedOptions.eventCode)) continue;
    if (eventName === "customEvent" && effect.triggerCode !== groupedOptions.eventCode) continue;
    if (effect.optional !== false && effect.triggerTiming === "when" && !eventIsLast) continue;
    if (!canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source) continue;
    if (isTriggerPrevented(state, source)) continue;
    const candidate = shouldDeferCustomEventChoice(state, eventName) ? { eventCard: uniqueEventCards[0], options: groupedOptions } : firstTriggerEventCandidate(state, effect, source, eventName, uniqueEventCards, groupedOptions, canChooseEffect);
    if (!candidate.eventCard) continue;
    if (!triggerSourceInRange(effect, source, eventName, candidate.eventCard)) continue;
    collected.push({ effect, source, index, eventCard: candidate.eventCard, options: triggerMatchedOptions(effect, candidate.options) });
  }
  collected.sort((a, b) => triggerPriority(state, a.effect) - triggerPriority(state, b.effect) || a.index - b.index);
  for (const trigger of collected) state.pendingTriggers.push(createPendingTrigger(state, trigger.effect, trigger.source, eventName, trigger.eventCard, trigger.options));
  setWaitingForPendingTriggerBucket(state);
}

function triggerSourceInRange(effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard: DuelCardInstance | undefined): boolean {
  if (effect.range.includes(source.location)) return true;
  return Boolean(
    effect.triggerSourceOnly
      && eventName === "destroyed"
      && eventCard?.uid === source.uid
      && source.previousLocation
      && effect.range.includes(source.previousLocation),
  );
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

function firstTriggerEventCandidate(
  state: DuelState,
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  eventName: DuelEventName,
  eventCards: DuelCardInstance[],
  options: DuelTriggerCollectOptions,
  canChooseEffect: DuelTriggerChooser,
): TriggerEventCandidate {
  for (const eventCard of eventCards) {
    const candidate = triggerEventCandidate(state, effect, eventName, eventCard, options);
    if (isBattleDestroyingSingleTrigger(effect, eventName) && candidate.eventCard?.uid !== source.uid) continue;
    if (effect.triggerSourceOnly && candidate.eventCard?.uid !== source.uid) continue;
    if (canChooseEffect(state, effect, source, eventName, candidate.eventCard, candidate.options)) return candidate;
  }
  return { options };
}

function triggerEventCandidate(
  state: DuelState,
  effect: DuelEffectDefinition,
  eventName: DuelEventName,
  eventCard: DuelCardInstance | undefined,
  options: DuelTriggerCollectOptions,
): TriggerEventCandidate {
  if (eventName === "detachedMaterial" && eventCard) return detachedMaterialTriggerCandidate(state, eventCard, options);
  if (!isBattleDestroyingTrigger(effect, eventName) || !eventCard) return { eventCard, options: eventCard ? eventCardReasonTriggerOptions(options, eventCard) : options };
  const destroyingUid = battleDestroyingSourceUid(state, eventCard);
  const destroyingCard = destroyingUid === undefined ? undefined : findCard(state, destroyingUid);
  if (!destroyingCard) return { eventCard, options };
  return { eventCard: destroyingCard, options: battleDestroyingTriggerOptions(options, eventCard) };
}

function eventCardReasonTriggerOptions(options: DuelTriggerCollectOptions, eventCard: DuelCardInstance): DuelTriggerCollectOptions {
  const reasonPayload = eventCardReasonPayload(eventCard);
  return {
    ...options,
    ...(options.eventPlayer === undefined ? { eventPlayer: eventCard.controller } : {}),
    ...(options.eventReason === undefined && reasonPayload.eventReason !== undefined ? { eventReason: reasonPayload.eventReason } : {}),
    ...(options.eventReasonPlayer === undefined && reasonPayload.eventReasonPlayer !== undefined ? { eventReasonPlayer: reasonPayload.eventReasonPlayer } : {}),
    ...(options.eventReasonCardUid === undefined && reasonPayload.eventReasonCardUid !== undefined ? { eventReasonCardUid: reasonPayload.eventReasonCardUid } : {}),
    ...(options.eventReasonEffectId === undefined && reasonPayload.eventReasonEffectId !== undefined ? { eventReasonEffectId: reasonPayload.eventReasonEffectId } : {}),
  };
}

function detachedMaterialTriggerCandidate(
  state: DuelState,
  detachedMaterial: DuelCardInstance,
  options: DuelTriggerCollectOptions,
): TriggerEventCandidate {
  const reasonPayload = eventCardReasonPayload(detachedMaterial);
  const holderUid = options.eventReasonCardUid ?? reasonPayload.eventReasonCardUid;
  const holder = holderUid === undefined ? undefined : findCard(state, holderUid);
  return {
    eventCard: holder ?? detachedMaterial,
    options: {
      ...options,
      ...(options.eventPlayer === undefined ? { eventPlayer: detachedMaterial.controller } : {}),
      ...(options.eventReason === undefined && reasonPayload.eventReason !== undefined ? { eventReason: reasonPayload.eventReason } : {}),
      ...(options.eventReasonPlayer === undefined && reasonPayload.eventReasonPlayer !== undefined ? { eventReasonPlayer: reasonPayload.eventReasonPlayer } : {}),
      ...(options.eventReasonCardUid === undefined && reasonPayload.eventReasonCardUid !== undefined ? { eventReasonCardUid: reasonPayload.eventReasonCardUid } : {}),
      ...(options.eventReasonEffectId === undefined && reasonPayload.eventReasonEffectId !== undefined ? { eventReasonEffectId: reasonPayload.eventReasonEffectId } : {}),
      ...eventCardStatePayload(detachedMaterial),
    },
  };
}

function shouldDeferCustomEventChoice(state: DuelState, eventName: DuelEventName): boolean {
  return eventName === "customEvent" && state.status === "resolving";
}

function battleDestroyingTriggerOptions(options: DuelTriggerCollectOptions, destroyedCard: DuelCardInstance): DuelTriggerCollectOptions {
  const reasonPayload = eventCardReasonPayload(destroyedCard);
  return {
    ...options,
    ...(options.eventPlayer === undefined ? { eventPlayer: destroyedCard.controller } : {}),
    ...(options.eventReason === undefined && reasonPayload.eventReason !== undefined ? { eventReason: reasonPayload.eventReason } : {}),
    ...(options.eventReasonPlayer === undefined && reasonPayload.eventReasonPlayer !== undefined ? { eventReasonPlayer: reasonPayload.eventReasonPlayer } : {}),
    ...(options.eventReasonCardUid === undefined && reasonPayload.eventReasonCardUid !== undefined ? { eventReasonCardUid: reasonPayload.eventReasonCardUid } : {}),
    ...(options.eventReasonEffectId === undefined && reasonPayload.eventReasonEffectId !== undefined ? { eventReasonEffectId: reasonPayload.eventReasonEffectId } : {}),
  };
}

function battleDestroyingSourceUid(state: DuelState, eventCard: DuelCardInstance | undefined): string | undefined {
  const attack = state.currentAttack ?? state.pendingBattle;
  if (!attack || !eventCard) return undefined;
  if (eventCard.uid === attack.attackerUid) return attack.targetUid;
  if (eventCard.uid === attack.targetUid) return attack.attackerUid;
  return undefined;
}

function isBattleDestroyingSingleTrigger(effect: DuelEffectDefinition, eventName: DuelEventName): boolean {
  return eventName === "battleDestroyed" && effect.triggerCode === 1139 && ((effect.luaTypeFlags ?? 0) & 0x1) !== 0;
}

function isBattleDestroyingTrigger(effect: DuelEffectDefinition, eventName: DuelEventName): boolean {
  return eventName === "battleDestroyed" && effect.triggerCode === 1139;
}

function triggerPriority(state: DuelState, effect: DuelEffectDefinition): number {
  return triggerBucketPriority(triggerBucket(state, effect));
}

function triggerCodeMatchesEvent(eventName: DuelEventName, triggerCode: number, eventCode: number): boolean {
  if (triggerCode === eventCode) return true;
  if (eventName === "counterAdded" && triggerCode === 0x10000 && eventCode > 0x10000 && eventCode < 0x20000) return true;
  if (eventName === "counterRemoved" && triggerCode === 0x20000 && eventCode > 0x20000 && eventCode < 0x30000) return true;
  if (eventName === "flipSummoned" && triggerCode === 1001 && eventCode === 1101) return true;
  return eventName === "battleDestroyed" && (triggerCode === 1139 || triggerCode === 1140) && (eventCode === 1139 || eventCode === 1140);
}

function triggerMatchedOptions(effect: DuelEffectDefinition, options: DuelTriggerCollectOptions): DuelTriggerCollectOptions {
  if (effect.triggerCode === undefined || options.eventCode === undefined || effect.triggerCode === options.eventCode) return options;
  return { ...options, eventCode: effect.triggerCode };
}

function createPendingTrigger(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard: DuelCardInstance | undefined, options: DuelTriggerCollectOptions): PendingTrigger {
  return {
    id: nextPendingTriggerId(state),
    player: effect.controller,
    sourceUid: source.uid,
    effectId: effect.id,
    eventName,
    triggerBucket: triggerBucket(state, effect),
    eventTriggerTiming: effect.triggerTiming ?? "if",
    ...eventCardReasonPayload(eventCard),
    ...(options.eventCode === undefined ? {} : { eventCode: options.eventCode }),
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
    ...eventCardStatePayload(eventCard),
    ...(options.eventPreviousState === undefined ? {} : { eventPreviousState: { ...options.eventPreviousState } }),
    ...(options.eventCurrentState === undefined ? {} : { eventCurrentState: { ...options.eventCurrentState } }),
    ...(effect.labelObjectUid === undefined ? {} : { effectLabelObjectUid: effect.labelObjectUid }),
    ...(effect.labelObjectUids === undefined ? {} : { effectLabelObjectUids: [...effect.labelObjectUids] }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
  };
}

function nextPendingTriggerId(state: DuelState): string {
  const base = `trigger-${state.log.length + 1}-${state.pendingTriggers.length + 1}`;
  if (!state.pendingTriggers.some((trigger) => trigger.id === base)) return base;
  for (let suffix = 2;; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!state.pendingTriggers.some((trigger) => trigger.id === candidate)) return candidate;
  }
}

function triggerBucket(state: DuelState, effect: DuelEffectDefinition): TriggerBucket {
  const turnPlayerBucket = effect.controller === state.turnPlayer;
  if (effect.optional === false) return turnPlayerBucket ? "turnMandatory" : "opponentMandatory";
  return turnPlayerBucket ? "turnOptional" : "opponentOptional";
}

function triggerBucketPriority(bucket: TriggerBucket): number {
  if (bucket === "turnMandatory") return 0;
  if (bucket === "opponentMandatory") return 1;
  if (bucket === "turnOptional") return 2;
  return 3;
}

function isTriggerPrevented(state: DuelState, card: DuelCardInstance): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 7) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createTriggerPreventContext(state, effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function continuousEffectAffectsCard(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): boolean {
  if (source.uid === card.uid) return true;
  if (continuousEffectIsPlayerTarget(effect)) return continuousEffectTargetsPlayer(effect, source, card.controller);
  if (effect.targetRange !== undefined) return continuousEffectTargetsCardLocation(effect, source, card);
  return false;
}

function continuousEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  if (effect.targetRange === undefined && !continuousEffectIsPlayerTarget(effect)) return source.controller === player;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  if (source.controller === player) return selfTarget !== 0;
  return opponentTarget !== 0;
}

function continuousEffectIsPlayerTarget(effect: DuelEffectDefinition): boolean {
  return ((effect.property ?? 0) & 0x800) !== 0;
}

function continuousEffectTargetsCardLocation(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): boolean {
  const [selfMask = 0, opponentMask = 0] = effect.targetRange ?? [];
  return locationMaskMatchesCard(card, source.controller === card.controller ? selfMask : opponentMask);
}

function locationMaskMatchesCard(card: DuelCardInstance, mask: number): boolean {
  if ((mask & locationMaskFromLocation(card.location)) !== 0) return true;
  if ((mask & 0x400) !== 0 && card.location === "spellTrapZone") return true;
  if ((mask & 0x800) !== 0 && card.location === "monsterZone" && card.sequence >= 0 && card.sequence <= 4) return true;
  return (mask & 0x1000) !== 0 && card.location === "monsterZone" && card.sequence >= 5 && card.sequence <= 6;
}

function locationMaskFromLocation(location: DuelCardInstance["location"]): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}

function createTriggerPreventContext(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): DuelEffectContext {
  return {
    duel: state,
    source,
    player: effect.controller,
    eventCard: card,
    checkOnly: true,
    targetUids: [card.uid],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [card];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  };
}
