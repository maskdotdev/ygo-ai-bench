import { findCard, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import {
  battleDestroyRedirectLocation,
  isReleasePrevented,
  leaveFieldRedirectLocation,
  moveDestinationRedirectLocation,
  shouldRedirectBanishMove,
  shouldRedirectToGraveyardMove,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import {
  applyDestroyPrevention,
  applyDestroyReplacement,
  applyReleaseReplacement,
  applySendReplacement,
  type ReplacementEffectHandlers,
} from "#duel/replacement-effects.js";
import type { DuelCardInstance, DuelEventName, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export interface CoreMovementHandlers {
  canMoveCardToLocation(state: DuelState, uid: string, to: DuelLocation, reason: number): boolean;
  collectTrigger(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  createContinuousContext(state: DuelState): ContinuousEffectContextFactory;
  createReplacementHandlers(state: DuelState): ReplacementEffectHandlers;
}

export function sendCoreDuelCardToGraveyard(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, handlers.createContinuousContext(state))) throw new Error(`Card ${uid} cannot be released`);
  const replacementHandlers = handlers.createReplacementHandlers(state);
  const replacement = applyReleaseReplacement(state, uid, controller, reason, replacementHandlers);
  if (replacement) return replacement;
  const sendReplacement = applySendReplacement(state, uid, controller, reason, replacementHandlers);
  if (sendReplacement) return sendReplacement;
  const createContext = handlers.createContinuousContext(state);
  if (shouldRedirectToGraveyardMove(state, uid, createContext)) return banishCoreDuelCard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "graveyard", createContext);
  if (redirectLocation && redirectLocation !== "graveyard") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason, reasonPlayer);
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Sent to the Graveyard");
  collectLeaveFieldTriggers(state, card, handlers);
  handlers.collectTrigger(state, "sentToGraveyard", card);
  return card;
}

export function destroyCoreDuelCard(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  const replacementHandlers = handlers.createReplacementHandlers(state);
  const indestructible = applyDestroyPrevention(state, uid, controller, reason, reasonPlayer, replacementHandlers);
  if (indestructible) return indestructible;
  const replacement = applyDestroyReplacement(state, uid, controller, reason, replacementHandlers);
  if (replacement) return replacement;
  const createContext = handlers.createContinuousContext(state);
  const battleRedirectLocation = (reason & duelReason.battle) !== 0 ? battleDestroyRedirectLocation(state, uid, createContext) : undefined;
  if (battleRedirectLocation && battleRedirectLocation !== "graveyard") {
    const moveReason = reason | duelReason.redirect;
    requireCoreDuelMoveAllowed(state, uid, battleRedirectLocation, moveReason, handlers);
    const card = moveDuelCard(state, uid, battleRedirectLocation, controller, moveReason, reasonPlayer);
    pushDuelLog(state, "destroy", card.controller, card.name, `Destroyed and moved to ${battleRedirectLocation}`);
    collectLeaveFieldTriggers(state, card, handlers);
    handlers.collectTrigger(state, "destroyed", card);
    if (battleRedirectLocation === "banished") handlers.collectTrigger(state, "banished", card);
    return card;
  }
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason, reasonPlayer);
  pushDuelLog(state, "destroy", card.controller, card.name, "Destroyed");
  collectLeaveFieldTriggers(state, card, handlers);
  handlers.collectTrigger(state, "destroyed", card);
  handlers.collectTrigger(state, "sentToGraveyard", card);
  return card;
}

export function banishCoreDuelCard(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  const createContext = handlers.createContinuousContext(state);
  if (shouldRedirectBanishMove(state, uid, createContext)) return sendCoreDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "banished", createContext);
  if (redirectLocation && redirectLocation !== "banished") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "banished", reason, handlers);
  const card = moveDuelCard(state, uid, "banished", controller, reason, reasonPlayer);
  pushDuelLog(state, "banish", card.controller, card.name, "Banished");
  collectLeaveFieldTriggers(state, card, handlers);
  handlers.collectTrigger(state, "banished", card);
  return card;
}

export function moveCoreDuelCardWithRedirects(
  state: DuelState,
  uid: string,
  to: DuelLocation,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  const createContext = handlers.createContinuousContext(state);
  const redirectLocation = moveDestinationRedirectLocation(state, uid, to, createContext) ?? leaveFieldRedirectLocation(state, uid, to, createContext);
  const destination = redirectLocation ?? to;
  const moveReason = redirectLocation ? reason | duelReason.redirect : reason;
  requireCoreDuelMoveAllowed(state, uid, destination, moveReason, handlers);
  const card = moveDuelCard(state, uid, destination, controller, moveReason, reasonPlayer);
  collectLeaveFieldTriggers(state, card, handlers);
  return card;
}

export function detachCoreDuelOverlayMaterials(
  state: DuelState,
  uid: string,
  count: number,
  controller: PlayerId | undefined,
  reason: number,
  handlers: CoreMovementHandlers,
): DuelCardInstance[] {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const detachCount = Math.max(0, Math.floor(count));
  if (detachCount === 0) return [];
  if (card.overlayUids.length < detachCount) throw new Error(`${card.name} does not have enough overlay materials`);
  const detachedUids = card.overlayUids.slice(0, detachCount);
  card.overlayUids = card.overlayUids.slice(detachCount);
  const detached: DuelCardInstance[] = [];
  for (const materialUid of detachedUids) {
    const material = moveDuelCard(state, materialUid, "graveyard", controller ?? card.controller, reason);
    pushDuelLog(state, "detachOverlay", material.controller, material.name, `Detached from ${card.name}`);
    handlers.collectTrigger(state, "sentToGraveyard", material);
    detached.push(material);
  }
  return detached;
}

function moveCoreDuelCardToRedirectedLocation(
  state: DuelState,
  uid: string,
  location: DuelLocation,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  if (location === "graveyard") return sendCoreDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  if (location === "banished") return banishCoreDuelCard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  return moveDuelCard(state, uid, location, controller, reason | duelReason.redirect, reasonPlayer);
}

function requireCoreDuelMoveAllowed(state: DuelState, uid: string, to: DuelLocation, reason: number, handlers: CoreMovementHandlers): void {
  if (!handlers.canMoveCardToLocation(state, uid, to, reason)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

function collectLeaveFieldTriggers(state: DuelState, card: DuelCardInstance, handlers: CoreMovementHandlers): void {
  if (card.previousLocation !== "monsterZone" && card.previousLocation !== "spellTrapZone") return;
  if (card.location === "monsterZone" || card.location === "spellTrapZone") return;
  handlers.collectTrigger(state, "leftField", card);
}
