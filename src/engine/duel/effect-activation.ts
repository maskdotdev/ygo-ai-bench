import { findCard, pushDuelLog, requireControlledCard } from "#duel/card-state.js";
import { markEffectUsed } from "#duel/effect-counts.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import type {
  DuelCardInstance,
  DuelEffectContext,
  DuelEventName,
  DuelLocation,
  DuelSession,
  DuelState,
  PendingTrigger,
  PlayerId,
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
  ): void;
  hasChainResponses(state: DuelState, player: PlayerId): boolean;
  resolveChain(state: DuelState): void;
  canAttemptSpecialSummonProcedure(state: DuelState, uid: string): boolean;
  specialSummonCard(state: DuelState, uid: string, player: PlayerId): DuelCardInstance;
}

export function activateDuelEffect(session: DuelSession, player: PlayerId, uid: string, effectId: string, handlers: DuelActivationHandlers): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid);
  if (!effect) throw new Error(`Effect ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  const targetUids: string[] = [];
  const ctx = handlers.createEffectContext(session.state, source, player, undefined, undefined, targetUids);
  const rollback = captureDuelState(session.state);
  try {
    if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
    if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
    handlers.pushChainLink(session.state, player, uid, effectId, undefined, undefined, targetUids, ctx.targetPlayer, ctx.targetParam);
    pushDuelLog(session.state, "activate", player, source.name, effect.id);
    markEffectUsed(session.state, effect);
    const responsePlayer = otherPlayer(player);
    if (handlers.hasChainResponses(session.state, responsePlayer)) {
      session.state.waitingFor = responsePlayer;
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
    if (!handlers.canAttemptSpecialSummonProcedure(session.state, uid)) throw new Error(`${source.name} cannot be Special Summoned`);
    markEffectUsed(session.state, effect);
    handlers.specialSummonCard(session.state, uid, player);
  } catch (error) {
    restoreDuelState(session.state, rollback);
    throw error;
  }
}

export function activateDuelPendingTrigger(session: DuelSession, player: PlayerId, triggerId: string, handlers: DuelActivationHandlers): void {
  const rollback = captureDuelState(session.state);
  try {
    const trigger = takePendingTrigger(session.state, player, triggerId);
    const effect = session.state.effects.find((candidate) => candidate.sourceUid === trigger.sourceUid && candidate.id === trigger.effectId);
    if (!effect) throw new Error(`Effect ${trigger.effectId} is not registered`);
    const source = findCard(session.state, trigger.sourceUid);
    const eventCard = trigger.eventCardUid === undefined ? undefined : findCard(session.state, trigger.eventCardUid);
    if (!source || (trigger.eventCardUid !== undefined && !eventCard)) throw new Error(`Trigger ${triggerId} lost its source or event card`);
    const targetUids: string[] = [];
    const ctx = handlers.createEffectContext(session.state, source, trigger.player, trigger.eventName, eventCard, targetUids);
    if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effect.id} could not be paid`);
    if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effect.id} are not legal`);
    handlers.pushChainLink(session.state, trigger.player, source.uid, effect.id, trigger.eventName, eventCard, targetUids, ctx.targetPlayer, ctx.targetParam);
    pushDuelLog(session.state, "trigger", trigger.player, source.name, effect.id);
    markEffectUsed(session.state, effect);
    const responsePlayer = otherPlayer(trigger.player);
    if (handlers.hasChainResponses(session.state, responsePlayer)) {
      session.state.waitingFor = responsePlayer;
      return;
    }
    handlers.resolveChain(session.state);
  } catch (error) {
    restoreDuelState(session.state, rollback);
    throw error;
  }
}

export function declineDuelPendingTrigger(session: DuelSession, player: PlayerId, triggerId: string): void {
  const trigger = takePendingTrigger(session.state, player, triggerId);
  const source = findCard(session.state, trigger.sourceUid);
  pushDuelLog(session.state, "declineTrigger", player, source?.name, trigger.effectId);
  session.state.waitingFor = session.state.pendingTriggers[0]?.player ?? session.state.turnPlayer;
}

function takePendingTrigger(state: DuelState, player: PlayerId, triggerId: string): PendingTrigger {
  const triggerIndex = state.pendingTriggers.findIndex((candidate) => candidate.id === triggerId && candidate.player === player);
  if (triggerIndex < 0) throw new Error(`Trigger ${triggerId} is not pending for player ${player}`);
  const [trigger] = state.pendingTriggers.splice(triggerIndex, 1);
  if (!trigger) throw new Error(`Trigger ${triggerId} is not pending`);
  return trigger;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
