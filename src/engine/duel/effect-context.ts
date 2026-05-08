import { findCard, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { negateDuelChainLink } from "#duel/chain-negation.js";
import { duelReason } from "#duel/reasons.js";
import type {
  ChainLink,
  DuelCardInstance,
  DuelEffectContext,
  DuelEventName,
  DuelLocation,
  DuelState,
  PlayerId,
} from "#duel/types.js";

export function createEffectContext(
  state: DuelState,
  source: DuelCardInstance,
  player: PlayerId,
  eventName?: DuelEventName,
  eventCard?: DuelCardInstance,
  targetUids: string[] = [],
  checkOnly = false,
  activationLocation: DuelLocation = source.location,
  activationSequence: number = source.sequence,
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
  operationInfos: NonNullable<DuelEffectContext["operationInfos"]> = [],
  possibleOperationInfos: NonNullable<DuelEffectContext["possibleOperationInfos"]> = [],
): DuelEffectContext {
  const ctx: DuelEffectContext = {
    duel: state,
    source,
    player,
    activationLocation,
    activationSequence,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCode === undefined ? {} : { eventCode }),
    ...(eventPlayer === undefined ? {} : { eventPlayer }),
    ...(eventValue === undefined ? {} : { eventValue }),
    ...(eventReason === undefined ? {} : { eventReason }),
    ...(eventReasonPlayer === undefined ? {} : { eventReasonPlayer }),
    ...(eventReasonCardUid === undefined ? {} : { eventReasonCardUid }),
    ...(eventReasonEffectId === undefined ? {} : { eventReasonEffectId }),
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(eventChainDepth === undefined ? {} : { eventChainDepth }),
    ...(eventChainLinkId === undefined ? {} : { eventChainLinkId }),
    ...(eventUids === undefined || eventUids.length === 0 ? {} : { eventUids: [...eventUids] }),
    ...(eventCard === undefined ? {} : { eventCard }),
    ...(checkOnly ? { checkOnly } : {}),
    targetUids,
    operationInfos,
    possibleOperationInfos,
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
    ...(chainLink === undefined ? {} : { chainLink }),
    log(detail) {
      pushDuelLog(state, "effect", player, source.name, detail);
    },
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller, duelReason.effect);
    },
    negateChainLink(chainLinkId) {
      return negateDuelChainLink(state, chainLinkId, player, source.name);
    },
    setTargets(uids) {
      targetUids.splice(0, targetUids.length, ...uids);
    },
    getTargets() {
      return targetUids.map((uid) => findCard(state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
    },
    setTargetPlayer(target) {
      ctx.targetPlayer = target;
    },
    setTargetParam(parameter) {
      ctx.targetParam = parameter;
    },
  };
  return ctx;
}
