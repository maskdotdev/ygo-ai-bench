import {
  findDestroyReplacementEffect,
  findIndestructibleEffect,
  findReleaseReplacementEffect,
  findSendReplacementEffect,
  type ContinuousEffectContextFactory,
  type ContinuousEffectMatch,
} from "#duel/continuous-effects.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export type ReplacementContextFactory = (effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance, checkOnly: boolean) => DuelEffectContext;
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
  handlers: ReplacementEffectHandlers,
): DuelCardInstance | undefined {
  if ((reason & duelReason.replace) !== 0) return undefined;
  const match = findDestroyReplacementEffect(state, uid, handlers.createContinuousContext);
  return applyReplacementEffect(state, match, controller, handlers, "destroyReplace", "Destruction replaced");
}

export function applyReleaseReplacement(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  handlers: ReplacementEffectHandlers,
): DuelCardInstance | undefined {
  if ((reason & duelReason.release) === 0 || (reason & duelReason.replace) !== 0) return undefined;
  const match = findReleaseReplacementEffect(state, uid, handlers.createContinuousContext);
  return applyReplacementEffect(state, match, controller, handlers, "releaseReplace", "Release replaced");
}

export function applySendReplacement(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  handlers: ReplacementEffectHandlers,
): DuelCardInstance | undefined {
  if ((reason & duelReason.replace) !== 0) return undefined;
  const match = findSendReplacementEffect(state, uid, handlers.createContinuousContext);
  return applyReplacementEffect(state, match, controller, handlers, "sendReplace", "Send replaced");
}

function applyReplacementEffect(
  state: DuelState,
  match: ContinuousEffectMatch | undefined,
  controller: PlayerId | undefined,
  handlers: ReplacementEffectHandlers,
  action: string,
  detail: string,
): DuelCardInstance | undefined {
  if (!match || !canUseEffectCount(state, match.effect)) return undefined;
  const ctx = handlers.createReplacementContext(match.effect, match.source, match.card, false);
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
