import { findCard } from "#duel/card-state.js";
import { getDuelFlagEffectCount } from "#duel/flags.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

const effectDoubleTribute = 150;
const flagHasDoubleTribute = 160015004;

export function tributeUnitCount(state: DuelState, card: DuelCardInstance, tributeTarget?: DuelCardInstance): number {
  return isDoubleTributeMaterial(state, card, tributeTarget) ? 2 : 1;
}

function isDoubleTributeMaterial(state: DuelState, card: DuelCardInstance, tributeTarget?: DuelCardInstance): boolean {
  if (getDuelFlagEffectCount(state, { ownerType: "card", ownerId: card.uid }, flagHasDoubleTribute) > 0) return true;
  return state.effects.some((effect) => {
    if (effect.event !== "continuous" || effect.code !== effectDoubleTribute) return false;
    const source = findCard(state, effect.sourceUid);
    if (!source || source.uid !== card.uid || !effect.range.includes(source.location)) return false;
    if (effect.valueCardPredicate && !tributeTarget) return false;
    const ctx = {
      duel: state,
      source,
      player: effect.controller,
      checkOnly: true,
      targetUids: tributeTarget ? [tributeTarget.uid] : [],
      log() {},
      moveCard() {
        return source;
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
    };
    if (effect.canActivate && !effect.canActivate(ctx)) return false;
    return !effect.valueCardPredicate || effect.valueCardPredicate(ctx, tributeTarget!);
  });
}
