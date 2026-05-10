import { findCard } from "#duel/card-state.js";
import { continuousEffectAppliesToCard, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { CardPosition, DuelCardInstance, DuelState } from "#duel/types.js";

export function continuousSetPosition(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): CardPosition | undefined {
  let position: CardPosition | undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 140) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx) || (effect.canActivate && !effect.canActivate(ctx))) continue;
    position = positionFromMask(effect.statValue?.(ctx, card) ?? effect.value);
  }
  return position;
}

function positionFromMask(mask: number | undefined): CardPosition | undefined {
  if (mask === undefined) return undefined;
  if ((mask & 0x1) !== 0) return "faceUpAttack";
  if ((mask & 0x4) !== 0) return "faceUpDefense";
  if ((mask & 0x8) !== 0) return "faceDownDefense";
  return undefined;
}
