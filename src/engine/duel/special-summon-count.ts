import { moveDuelCard } from "#duel/card-state.js";
import { matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelLocation, DuelState, PlayerId } from "#duel/types.js";

const blueEyesSpiritDragonCode = 59822133;
const legacySpiritEliminationCountLimitCode = 69832741;
const simultaneousSpecialSummonLimitCodes = [blueEyesSpiritDragonCode, legacySpiritEliminationCountLimitCode];

export function maxSimultaneousSpecialSummonCount(state: DuelState, player: PlayerId, availableZones: number): number {
  if (availableZones <= 1) return Math.max(0, availableZones);
  return isSimultaneousSpecialSummonCountLimited(state, player) ? 1 : availableZones;
}

export function isSimultaneousSpecialSummonCountLimited(state: DuelState, player: PlayerId): boolean {
  const context = createSpecialSummonCountContext(state);
  return simultaneousSpecialSummonLimitCodes.some((code) => matchingPlayerEffects(state, player, code, context).length > 0);
}

function createSpecialSummonCountContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid: string, to: DuelLocation, controller?: PlayerId) {
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
