import {
  findIndestructibleEffect,
  type ContinuousEffectContextFactory,
  type ContinuousEffectMatch,
} from "#duel/continuous-effects.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { findDestroyReplacementEffects, findDestroySubstituteEffects, findReleaseReplacementEffects, findSendReplacementEffects } from "#duel/replacement-effect-matches.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export type ReplacementContextFactory = (
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  card: DuelCardInstance,
  checkOnly: boolean,
  reason: number,
  destination: DuelLocation,
  reasonPlayer: PlayerId | undefined,
  payload?: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
) => DuelEffectContext;
export type ReplacementLogger = (action: string, player: PlayerId, cardName: string, detail: string) => void;

export interface ReplacementEffectHandlers {
  createContinuousContext: ContinuousEffectContextFactory;
  createReplacementContext: ReplacementContextFactory;
  log: ReplacementLogger;
}

export function applyDestroyPrevention(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance | undefined {
  const match = findIndestructibleEffect(state, uid, reason, handlers.createContinuousContext, reasonPlayer);
  if (!match) return undefined;
  consumeIndestructibleCount(match.effect);
  handlers.log("destroyPrevented", controller ?? match.card.controller, match.card.name, "Destruction prevented");
  return match.card;
}

export function applyDestroyReplacement(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance | undefined {
  if ((reason & duelReason.replace) !== 0) return undefined;
  const matches = findDestroyReplacementEffects(state, uid, handlers.createContinuousContext);
  return applyFirstReplacementEffect(state, matches, controller, reason, "graveyard", reasonPlayer, handlers, "destroyReplace", "Destruction replaced", payload);
}

export function findApplicableDestroySubstitutes(
  state: DuelState,
  uid: string,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): ContinuousEffectMatch[] {
  if ((reason & duelReason.replace) !== 0) return [];
  const matches = findDestroySubstituteEffects(state, uid, reason, reasonPlayer, handlers.createContinuousContext);
  return matches.filter((match) => destroySubstituteCanApply(state, match, reason, reasonPlayer, handlers, payload));
}

export function markDestroySubstitutesUsed(state: DuelState, matches: ContinuousEffectMatch[]): void {
  for (const match of matches) {
    if (canUseEffectCount(state, match.effect)) markEffectUsed(state, match.effect);
  }
}

export function applyReleaseReplacement(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance | undefined {
  if ((reason & duelReason.release) === 0 || (reason & duelReason.replace) !== 0) return undefined;
  const matches = findReleaseReplacementEffects(state, uid, handlers.createContinuousContext);
  return applyFirstReplacementEffect(state, matches, controller, reason, "graveyard", reasonPlayer, handlers, "releaseReplace", "Release replaced", payload);
}

export function applySendReplacement(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance | undefined {
  if ((reason & duelReason.replace) !== 0) return undefined;
  const matches = findSendReplacementEffects(state, uid, handlers.createContinuousContext);
  return applyFirstReplacementEffect(state, matches, controller, reason, "graveyard", reasonPlayer, handlers, "sendReplace", "Send replaced", payload);
}

function applyFirstReplacementEffect(
  state: DuelState,
  matches: ContinuousEffectMatch[],
  controller: PlayerId | undefined,
  reason: number,
  destination: DuelLocation,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  action: string,
  detail: string,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
): DuelCardInstance | undefined {
  for (const match of matches) {
    if (!replacementEffectCanApply(state, match, reason, destination, reasonPlayer, handlers, payload)) continue;
    const replacement = applyReplacementEffect(state, match, controller, reason, destination, reasonPlayer, handlers, action, detail, payload);
    if (replacement) return replacement;
  }
  return undefined;
}

function replacementEffectCanApply(
  state: DuelState,
  match: ContinuousEffectMatch,
  reason: number,
  destination: DuelLocation,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
): boolean {
  if (!canUseEffectCount(state, match.effect)) return false;
  const ctx = handlers.createReplacementContext(match.effect, match.source, match.card, true, reason, destination, reasonPlayer, payload);
  if (match.effect.valueCardPredicate && !match.effect.valueCardPredicate(ctx, match.card)) return false;
  if (match.effect.cost && !match.effect.cost(ctx)) return false;
  return !match.effect.target || match.effect.target(ctx);
}

function destroySubstituteCanApply(
  state: DuelState,
  match: ContinuousEffectMatch,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
): boolean {
  if (!canUseEffectCount(state, match.effect)) return false;
  const ctx = handlers.createReplacementContext(match.effect, match.source, match.card, true, reason, "graveyard", reasonPlayer, payload);
  if (match.effect.valuePredicate) return match.effect.valuePredicate(ctx, reasonPlayer);
  return match.effect.value === undefined || match.effect.value !== 0;
}

function applyReplacementEffect(
  state: DuelState,
  match: ContinuousEffectMatch | undefined,
  controller: PlayerId | undefined,
  reason: number,
  destination: DuelLocation,
  reasonPlayer: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  action: string,
  detail: string,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
): DuelCardInstance | undefined {
  if (!match || !canUseEffectCount(state, match.effect)) return undefined;
  const ctx = handlers.createReplacementContext(match.effect, match.source, match.card, false, reason, destination, reasonPlayer, payload);
  if (match.effect.cost && !match.effect.cost(ctx)) return undefined;
  if (match.effect.target && !match.effect.target(ctx)) return undefined;
  match.effect.operation(ctx);
  markEffectUsed(state, match.effect);
  handlers.log(action, controller ?? match.card.controller, match.card.name, detail);
  return match.card;
}

function consumeIndestructibleCount(effect: DuelEffectDefinition): void {
  if (effect.code !== 47) return;
  effect.value = Math.max(0, (effect.value ?? 1) - 1);
}
