import { findCard, pushDuelLog, requireControlledCard } from "#duel/card-state.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { pruneSpentMandatoryPendingTriggers } from "#duel/pending-trigger-actions.js";
import { otherPlayer } from "#duel/player-id.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { placeActivatedSpellTrapCard } from "#duel/spell-trap-activation.js";
import { quickEffectEventContext } from "#duel/effect-event-context.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import { pendingTriggerBucketsForState, setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type {
  DuelCardInstance,
  DuelEffectContext,
  DuelEventCardState,
  DuelEventName,
  DuelLocation,
  DuelSession,
  DuelState,
  ChainLink,
  PlayerId,
  TriggerBucket,
} from "#duel/types.js";

export interface DuelActivationHandlers {
  createEffectContext(
    state: DuelState,
    source: DuelCardInstance,
    player: PlayerId,
    eventName?: DuelEventName,
    eventCard?: DuelCardInstance,
    targetUids?: string[],
    checkOnly?: boolean,
    activationLocation?: DuelLocation,
    activationSequence?: number,
    targetPlayer?: PlayerId,
    targetParam?: number,
    chainLink?: ChainLink,
    eventCode?: number,
    eventPlayer?: PlayerId,
    eventValue?: number,
    eventReason?: number,
    eventReasonPlayer?: PlayerId,
    eventReasonCardUid?: string,
    eventReasonEffectId?: number,
    relatedEffectId?: number,
    eventChainDepth?: number,
    eventChainLinkId?: string,
    eventUids?: string[],
  ): DuelEffectContext;
  pushChainLink(
    state: DuelState,
    player: PlayerId,
    sourceUid: string,
    effectId: string,
    eventName?: DuelEventName,
    eventCard?: DuelCardInstance,
    targetUids?: string[],
    targetPlayer?: PlayerId,
    targetParam?: number,
    eventCode?: number,
    eventPlayer?: PlayerId,
    eventValue?: number,
    eventReason?: number,
    eventReasonPlayer?: PlayerId,
    eventReasonCardUid?: string,
    eventReasonEffectId?: number,
    relatedEffectId?: number,
    eventChainDepth?: number,
    eventChainLinkId?: string,
    eventUids?: string[],
    eventPreviousState?: DuelEventCardState,
    eventCurrentState?: DuelEventCardState,
    eventTriggerTiming?: ChainLink["eventTriggerTiming"],
    operationInfos?: ChainLink["operationInfos"],
    possibleOperationInfos?: ChainLink["possibleOperationInfos"],
    effectLabel?: number,
  ): void;
  hasChainResponses(state: DuelState, player: PlayerId): boolean;
  resolveChain(state: DuelState): void;
  canAttemptSpecialSummonProcedure(state: DuelState, uid: string): boolean;
  canSpecialSummonCard(state: DuelState, uid: string, player: PlayerId): boolean;
  specialSummonCard(state: DuelState, uid: string, player: PlayerId): DuelCardInstance;
}

export function activateDuelEffect(session: DuelSession, player: PlayerId, uid: string, effectId: string, handlers: DuelActivationHandlers): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid);
  if (!effect) throw new Error(`Effect ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  const targetUids: string[] = [];
  const quickEvent = quickEffectEventContext(session.state, effect);
  const ctx = handlers.createEffectContext(
    session.state,
    source,
    player,
    quickEvent?.eventName,
    quickEvent?.eventCard,
    targetUids,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    quickEvent?.eventCode,
    quickEvent?.eventPlayer,
    quickEvent?.eventValue,
    quickEvent?.eventReason,
    quickEvent?.eventReasonPlayer,
    quickEvent?.eventReasonCardUid,
    quickEvent?.eventReasonEffectId,
    quickEvent?.relatedEffectId,
    quickEvent?.eventChainDepth,
    quickEvent?.eventChainLinkId,
    quickEvent?.eventUids,
  );
  const rollback = captureDuelState(session.state);
  try {
    if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
    if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
    handlers.pushChainLink(
      session.state,
      player,
      uid,
      effectId,
      quickEvent?.eventName,
      quickEvent?.eventCard,
      targetUids,
      ctx.targetPlayer,
      ctx.targetParam,
      quickEvent?.eventCode,
      quickEvent?.eventPlayer,
      quickEvent?.eventValue,
      quickEvent?.eventReason,
      quickEvent?.eventReasonPlayer,
      quickEvent?.eventReasonCardUid,
      quickEvent?.eventReasonEffectId,
      quickEvent?.relatedEffectId,
      quickEvent?.eventChainDepth,
      quickEvent?.eventChainLinkId,
      quickEvent?.eventUids,
      quickEvent?.eventPreviousState,
      quickEvent?.eventCurrentState,
      quickEvent?.eventTriggerTiming,
      ctx.operationInfos ?? [],
      ctx.possibleOperationInfos ?? [],
      ctx.effectLabel,
    );
    placeActivatedSpellTrapCard(session.state, player, source, effect);
    pushDuelLog(session.state, "activate", player, source.name, effect.id);
    markEffectUsed(session.state, effect);
    const responsePlayer = otherPlayer(player);
    const chainPlayer = nextChainResponsePlayer(session.state, player, responsePlayer, handlers);
    if (chainPlayer !== undefined) {
      session.state.waitingFor = chainPlayer;
      return;
    }
    handlers.resolveChain(session.state);
  } catch (error) {
    restoreDuelState(session.state, rollback);
    throw error;
  }
}

export function specialSummonDuelByProcedure(session: DuelSession, player: PlayerId, uid: string, effectId: string, handlers: DuelActivationHandlers): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid && candidate.event === "summonProcedure");
  if (!effect) throw new Error(`Summon procedure ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  if (!effect.range.includes(source.location)) throw new Error(`${source.name} summon procedure is not in range`);
  const ctx = handlers.createEffectContext(session.state, source, player);
  if (!handlers.canAttemptSpecialSummonProcedure(session.state, uid)) throw new Error(`${source.name} cannot be Special Summoned`);
  if (effect.canActivate && !effect.canActivate(ctx)) throw new Error(`Condition for ${effectId} is not legal`);
  const rollback = captureDuelState(session.state);
  try {
    if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
    if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
    if (effect.operation) effect.operation(ctx);
    const currentSource = requireControlledCard(session.state, player, uid);
    if (!effect.range.includes(currentSource.location)) throw new Error(`${source.name} summon procedure is no longer in range`);
    if (!handlers.canSpecialSummonCard(session.state, uid, player)) throw new Error(`${source.name} cannot be Special Summoned`);
    markEffectUsed(session.state, effect);
    markProcedureComplete(handlers.specialSummonCard(session.state, uid, player));
  } catch (error) {
    restoreDuelState(session.state, rollback);
    throw error;
  }
}

export function activateDuelPendingTrigger(session: DuelSession, player: PlayerId, triggerId: string, triggerBucket: TriggerBucket, handlers: DuelActivationHandlers): void {
  const rollback = captureDuelState(session.state);
  try {
    const trigger = takePendingTrigger(session.state, player, triggerId, triggerBucket);
    const effect = session.state.effects.find((candidate) => candidate.sourceUid === trigger.sourceUid && candidate.id === trigger.effectId);
    if (!effect) throw new Error(`Effect ${trigger.effectId} is not registered`);
    if (!canUseEffectCount(session.state, effect)) throw new Error(`Count limit for ${effect.id} has already been used`);
    const source = findCard(session.state, trigger.sourceUid);
    const eventCard = trigger.eventCardUid === undefined ? undefined : findCard(session.state, trigger.eventCardUid);
    if (!source || (trigger.eventCardUid !== undefined && !eventCard)) throw new Error(`Trigger ${triggerId} lost its source or event card`);
    const targetUids: string[] = [];
    const ctx = handlers.createEffectContext(
      session.state,
      source,
      trigger.player,
      trigger.eventName,
      eventCard,
      targetUids,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      trigger.eventCode,
      trigger.eventPlayer,
      trigger.eventValue,
      trigger.eventReason,
      trigger.eventReasonPlayer,
      trigger.eventReasonCardUid,
      trigger.eventReasonEffectId,
      trigger.relatedEffectId,
      trigger.eventChainDepth,
      trigger.eventChainLinkId,
      trigger.eventUids,
    );
    if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effect.id} could not be paid`);
    if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effect.id} are not legal`);
    handlers.pushChainLink(
      session.state,
      trigger.player,
      source.uid,
      effect.id,
      trigger.eventName,
      eventCard,
      targetUids,
      ctx.targetPlayer,
      ctx.targetParam,
      trigger.eventCode,
      trigger.eventPlayer,
      trigger.eventValue,
      trigger.eventReason,
      trigger.eventReasonPlayer,
      trigger.eventReasonCardUid,
      trigger.eventReasonEffectId,
      trigger.relatedEffectId,
      trigger.eventChainDepth,
      trigger.eventChainLinkId,
      trigger.eventUids,
      trigger.eventPreviousState,
      trigger.eventCurrentState,
      trigger.eventTriggerTiming,
      ctx.operationInfos ?? [],
      ctx.possibleOperationInfos ?? [],
      ctx.effectLabel,
    );
    pushDuelLog(session.state, "trigger", trigger.player, source.name, effect.id);
    markEffectUsed(session.state, effect);
    pruneSpentMandatoryPendingTriggers(session.state);
    if (shouldContinueTriggerSelection(session.state)) {
      setWaitingForPendingTriggerBucket(session.state);
      return;
    }
    const responsePlayer = otherPlayer(trigger.player);
    const chainPlayer = nextChainResponsePlayer(session.state, trigger.player, responsePlayer, handlers);
    if (chainPlayer !== undefined) {
      session.state.waitingFor = chainPlayer;
      return;
    }
    handlers.resolveChain(session.state);
  } catch (error) {
    restoreDuelState(session.state, rollback);
    throw error;
  }
}

export function declineDuelPendingTrigger(session: DuelSession, player: PlayerId, triggerId: string, triggerBucket: TriggerBucket): DuelState["pendingTriggers"][number] {
  const trigger = takePendingTrigger(session.state, player, triggerId, triggerBucket);
  const source = findCard(session.state, trigger.sourceUid);
  pushDuelLog(session.state, "declineTrigger", player, source?.name, trigger.effectId);
  setWaitingForPendingTriggerBucket(session.state);
  return trigger;
}

export function finishDuelPendingTriggerSelection(session: DuelSession, handlers: DuelActivationHandlers): void {
  const lastLink = session.state.chain.at(-1);
  if (!lastLink || shouldContinueTriggerSelection(session.state)) return;
  const responsePlayer = otherPlayer(lastLink.player);
  const chainPlayer = nextChainResponsePlayer(session.state, lastLink.player, responsePlayer, handlers);
  if (chainPlayer !== undefined) {
    session.state.waitingFor = chainPlayer;
    return;
  }
  handlers.resolveChain(session.state);
}

export function shouldContinueTriggerSelection(state: DuelState): boolean {
  if (state.pendingTriggers.length === 0) return false;
  const firstLink = state.chain[0];
  if (!firstLink) return true;
  return state.pendingTriggers.every((trigger) => triggerEventPayloadMatchesLink(trigger, firstLink));
}

function triggerEventPayloadMatchesLink(trigger: DuelState["pendingTriggers"][number], link: ChainLink): boolean {
  const sameEventGroup = sameOptionalStringList(trigger.eventUids, link.eventUids) && trigger.eventUids !== undefined && link.eventUids !== undefined;
  return (
    trigger.eventName === link.eventName &&
    trigger.eventCode === link.eventCode &&
    trigger.eventPlayer === link.eventPlayer &&
    trigger.eventValue === link.eventValue &&
    (sameEventGroup || trigger.eventReason === link.eventReason) &&
    (sameEventGroup || trigger.eventReasonPlayer === link.eventReasonPlayer) &&
    (sameEventGroup || trigger.eventReasonCardUid === link.eventReasonCardUid) &&
    (sameEventGroup || trigger.eventReasonEffectId === link.eventReasonEffectId) &&
    trigger.relatedEffectId === link.relatedEffectId &&
    trigger.eventChainDepth === link.eventChainDepth &&
    trigger.eventChainLinkId === link.eventChainLinkId &&
    (sameEventGroup || trigger.eventCardUid === link.eventCardUid) &&
    sameOptionalStringList(trigger.eventUids, link.eventUids) &&
    (sameEventGroup || sameEventCardState(trigger.eventPreviousState, link.eventPreviousState)) &&
    (sameEventGroup || sameEventCardState(trigger.eventCurrentState, link.eventCurrentState))
  );
}

function sameEventCardState(left: DuelEventCardState | undefined, right: DuelEventCardState | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.controller === right.controller && left.location === right.location && left.sequence === right.sequence && left.position === right.position && left.faceUp === right.faceUp;
}

function sameOptionalStringList(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function takePendingTrigger(state: DuelState, player: PlayerId, triggerId: string, triggerBucket: TriggerBucket): DuelState["pendingTriggers"][number] {
  const activeBucket = pendingTriggerBucketsForState(state)[0];
  if (!activeBucket || activeBucket.player !== player || activeBucket.triggerBucket !== triggerBucket) {
    throw new Error(`Trigger ${triggerId} is not pending in the active ${triggerBucket} bucket for player ${player}`);
  }
  const triggerIndex = state.pendingTriggers.findIndex((candidate) => candidate.id === triggerId && candidate.player === player);
  if (triggerIndex < 0) throw new Error(`Trigger ${triggerId} is not pending for player ${player}`);
  if (state.pendingTriggers[triggerIndex]?.triggerBucket !== triggerBucket) throw new Error(`Trigger ${triggerId} is not pending in bucket ${triggerBucket}`);
  const [trigger] = state.pendingTriggers.splice(triggerIndex, 1);
  if (!trigger) throw new Error(`Trigger ${triggerId} is not pending`);
  return trigger;
}

function nextChainResponsePlayer(state: DuelState, activatingPlayer: PlayerId, firstResponder: PlayerId, handlers: DuelActivationHandlers): PlayerId | undefined {
  if (handlers.hasChainResponses(state, firstResponder)) return firstResponder;
  if (handlers.hasChainResponses(state, activatingPlayer)) return activatingPlayer;
  return undefined;
}
