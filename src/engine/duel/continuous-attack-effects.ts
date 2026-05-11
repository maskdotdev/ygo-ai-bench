import { findCard } from "#duel/card-state.js";
import { attackAllMonsterCount, continuousEffectAppliesToCard, extraMonsterAttackCount, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

export function spentMonsterOnlyAttackTargetAllowed(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  if (!state.attacksDeclared.includes(attacker.uid)) return true;
  if (extraMonsterAttackCount(state, attacker, createContext) > 0) return true;
  if (attackAllMonsterCount(state, attacker, createContext) <= 0) return true;
  let hasAttackAllRestriction = false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 193) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, attacker);
    if (!continuousEffectAppliesToCard(effect, source, attacker, ctx)) continue;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    hasAttackAllRestriction = true;
    if (!effect.valueCardPredicate || effect.valueCardPredicate(ctx, target)) return true;
  }
  return !hasAttackAllRestriction;
}
