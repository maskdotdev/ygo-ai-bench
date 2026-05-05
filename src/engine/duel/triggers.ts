import { findCard, moveDuelCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelState, PendingTrigger, PlayerId, TriggerBucket } from "#duel/types.js";

export type DuelTriggerChooser = (state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard?: DuelCardInstance) => boolean;

export interface DuelTriggerCollectOptions {
  eventIsLast?: boolean;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  relatedEffectId?: number;
  eventUids?: string[];
}

export function collectTriggerEffects(state: DuelState, eventName: DuelEventName, canChooseEffect: DuelTriggerChooser, eventCard?: DuelCardInstance, options: DuelTriggerCollectOptions = {}): void {
  const collected: Array<{ effect: DuelEffectDefinition; source: DuelCardInstance; index: number }> = [];
  const eventIsLast = options.eventIsLast ?? true;
  for (const [index, effect] of state.effects.entries()) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (effect.triggerCode !== undefined && options.eventCode !== undefined && !triggerCodeMatchesEvent(eventName, effect.triggerCode, options.eventCode)) continue;
    if (eventName === "customEvent" && effect.triggerCode !== options.eventCode) continue;
    if (effect.optional !== false && effect.triggerTiming === "when" && !eventIsLast) continue;
    if (!canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (effect.triggerSourceOnly && eventCard?.uid !== source?.uid) continue;
    if (!source || !effect.range.includes(source.location)) continue;
    if (isTriggerPrevented(state, source)) continue;
    if (!canChooseEffect(state, effect, source, eventName, eventCard)) continue;
    collected.push({ effect, source, index });
  }
  collected.sort((a, b) => triggerPriority(state, a.effect) - triggerPriority(state, b.effect) || a.index - b.index);
  for (const trigger of collected) state.pendingTriggers.push(createPendingTrigger(state, trigger.effect, trigger.source, eventName, eventCard, options));
  setWaitingForPendingTriggerBucket(state);
}

function triggerPriority(state: DuelState, effect: DuelEffectDefinition): number {
  return triggerBucketPriority(triggerBucket(state, effect));
}

function triggerCodeMatchesEvent(eventName: DuelEventName, triggerCode: number, eventCode: number): boolean {
  if (triggerCode === eventCode) return true;
  if (eventName === "flipSummoned" && triggerCode === 1001 && eventCode === 1101) return true;
  return eventName === "battleDestroyed" && (triggerCode === 1139 || triggerCode === 1140) && (eventCode === 1139 || eventCode === 1140);
}

function createPendingTrigger(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard: DuelCardInstance | undefined, options: DuelTriggerCollectOptions): PendingTrigger {
  return {
    id: `trigger-${state.log.length + 1}-${state.pendingTriggers.length + 1}`,
    player: effect.controller,
    sourceUid: source.uid,
    effectId: effect.id,
    eventName,
    triggerBucket: triggerBucket(state, effect),
    ...(options.eventCode === undefined ? {} : { eventCode: options.eventCode }),
    ...(options.eventPlayer === undefined ? {} : { eventPlayer: options.eventPlayer }),
    ...(options.eventValue === undefined ? {} : { eventValue: options.eventValue }),
    ...(options.eventReason === undefined ? {} : { eventReason: options.eventReason }),
    ...(options.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: options.eventReasonPlayer }),
    ...(options.relatedEffectId === undefined ? {} : { relatedEffectId: options.relatedEffectId }),
    ...(options.eventUids === undefined || options.eventUids.length === 0 ? {} : { eventUids: [...options.eventUids] }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
  };
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
  return (effect.targetRange !== undefined || ((effect.property ?? 0) & 0x800) !== 0) && continuousEffectTargetsPlayer(effect, source, card.controller);
}

function continuousEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  if (effect.targetRange === undefined && ((effect.property ?? 0) & 0x800) === 0) return source.controller === player;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  if (source.controller === player) return selfTarget !== 0;
  return opponentTarget !== 0;
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
