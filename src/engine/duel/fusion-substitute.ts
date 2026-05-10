import { findCard } from "#duel/card-state.js";
import { isCardDisabled, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelCardInstance, DuelLocation, DuelState } from "#duel/types.js";

const luaEffectFusionSubstitute = 234;
const effectFlagCannotDisable = 0x400;

export function canUseFusionSubstitute(state: DuelState, material: DuelCardInstance, fusionTarget: DuelCardInstance): boolean {
  if (material.uid === fusionTarget.uid) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== luaEffectFusionSubstitute || effect.sourceUid !== material.uid) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const canBeDisabled = ((effect.property ?? 0) & effectFlagCannotDisable) === 0;
    if (canBeDisabled && isFieldLocation(source.location) && isCardDisabled(state, source, createFusionSubstituteCheckContext(state))) continue;
    const ctx = createEffectContext(state, source, effect.controller, undefined, fusionTarget, [], true);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.value === 0) continue;
    if (effect.valueCardPredicate && !effect.valueCardPredicate(ctx, fusionTarget)) continue;
    return true;
  }
  return false;
}

function createFusionSubstituteCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => createEffectContext(state, source, effect.controller, undefined, card, [], true);
}

function isFieldLocation(location: DuelLocation): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}
