import { matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { moveDuelCard } from "#duel/card-state.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const flagNoTribute = 160001029;

export function isNoTributePlayerAffected(session: DuelSession, player: PlayerId): boolean {
  return matchingPlayerEffects(session.state, player, flagNoTribute, createPlayerCheckContext(session)).length > 0;
}

function createPlayerCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}
