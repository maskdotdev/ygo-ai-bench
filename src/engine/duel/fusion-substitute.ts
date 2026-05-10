import { findCard } from "#duel/card-state.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

const luaEffectFusionSubstitute = 234;

export function canUseFusionSubstitute(state: DuelState, material: DuelCardInstance, fusionTarget: DuelCardInstance): boolean {
  if (material.uid === fusionTarget.uid) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== luaEffectFusionSubstitute || effect.sourceUid !== material.uid) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createEffectContext(state, source, effect.controller, undefined, fusionTarget, [], true);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.value === 0) continue;
    if (effect.valueCardPredicate && !effect.valueCardPredicate(ctx, fusionTarget)) continue;
    return true;
  }
  return false;
}
