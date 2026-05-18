import { findCard } from "#duel/card-state.js";
import {
  continuousEffectAffectsCard,
  continuousEffectAppliesToCard,
  type ContinuousEffectContextFactory,
  type ContinuousEffectMatch,
} from "#duel/continuous-effects.js";
import { orderReplacementEffects } from "#duel/replacement-effect-order.js";
import type { DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export function findDestroyReplacementEffects(
  state: DuelState,
  uid: string,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 50, undefined, reason, "graveyard", reasonPlayer, createContext);
}

export function findDestroySubstituteEffects(
  state: DuelState,
  uid: string,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  const card = findCard(state, uid);
  if (!card) return [];
  const matches: ContinuousEffectMatch[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 45) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card, { eventReason: reason, eventReasonPlayer: reasonPlayer ?? card.controller, eventDestination: "graveyard" });
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) matches.push({ effect, source, card });
  }
  return matches;
}

export function findReleaseReplacementEffects(
  state: DuelState,
  uid: string,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 51, undefined, reason, "graveyard", reasonPlayer, createContext);
}

export function findSendReplacementEffects(
  state: DuelState,
  uid: string,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 52, undefined, reason, "graveyard", reasonPlayer, createContext);
}

function findReplacementEffects(
  state: DuelState,
  uid: string,
  firstCode: number,
  secondCode: number | undefined,
  reason: number,
  destination: DuelLocation,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  const card = findCard(state, uid);
  if (!card) return [];
  const matches: ContinuousEffectMatch[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || (effect.code !== firstCode && effect.code !== secondCode)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card, { eventReason: reason, eventReasonPlayer: reasonPlayer ?? card.controller, eventDestination: destination });
    if (!continuousEffectAffectsCard(effect, source, card) && !effect.valueCardPredicate) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) matches.push({ effect, source, card });
  }
  return orderReplacementEffects(state, matches);
}
