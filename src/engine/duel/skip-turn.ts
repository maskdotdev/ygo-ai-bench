import { findCard } from "#duel/card-state.js";
import { continuousEffectTargetsPlayer, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function isTurnSkipped(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 188) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location) || !continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}
