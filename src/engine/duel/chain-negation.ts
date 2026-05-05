import { findCard, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { isChainLinkNegationPrevented } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectContext, DuelState, PlayerId } from "#duel/types.js";

export function negateDuelChainLink(state: DuelState, chainLinkId: string, player: PlayerId, cardName: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || !canNegateDuelChainLink(state, chainLinkId)) return false;
  link.negated = true;
  link.disableReason = duelReason.effect;
  link.disablePlayer = player;
  pushDuelLog(state, "negate", player, cardName, link.effectId);
  return true;
}

export function canNegateDuelChainLink(state: DuelState, chainLinkId: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || link.negated) return false;
  const source = findCard(state, link.sourceUid);
  return !source || !isChainLinkNegationPrevented(state, source, createChainNegationContext(state));
}

function createChainNegationContext(state: DuelState) {
  return (effect: { controller: PlayerId }, source: DuelCardInstance, card?: DuelCardInstance): DuelEffectContext => {
    const targetUids: string[] = [];
    return {
      duel: state,
      source,
      player: effect.controller,
      checkOnly: true,
      ...(card === undefined ? {} : { eventCard: card }),
      targetUids,
      log(detail) {
        pushDuelLog(state, "effect", effect.controller, source.name, detail);
      },
      moveCard(uid, to, controller) {
        return moveDuelCard(state, uid, to, controller, duelReason.effect);
      },
      negateChainLink(targetChainLinkId) {
        return negateDuelChainLink(state, targetChainLinkId, effect.controller, source.name);
      },
      setTargets(uids) {
        targetUids.splice(0, targetUids.length, ...uids);
      },
      getTargets() {
        return targetUids.map((uid) => findCard(state, uid)).filter((candidate): candidate is DuelCardInstance => Boolean(candidate));
      },
      setTargetPlayer(player) {
        this.targetPlayer = player;
      },
      setTargetParam(parameter) {
        this.targetParam = parameter;
      },
    };
  };
}
