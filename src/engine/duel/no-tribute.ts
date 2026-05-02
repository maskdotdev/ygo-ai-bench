import { moveDuelCard } from "#duel/card-state.js";
import { matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelState, PlayerId } from "#duel/types.js";

const flagNoTribute = 160001029;

export function isNoTributeSummonAllowed(state: DuelState, player: PlayerId): boolean {
  return matchingPlayerEffects(state, player, flagNoTribute, createPlayerCheckContext(state)).length > 0;
}

function createPlayerCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
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
