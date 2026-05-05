import { findCard, getCards, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import {
  battleDestroyRedirectLocation,
  isReleasePrevented,
  leaveFieldRedirectLocation,
  moveDestinationRedirectLocation,
  shouldRedirectBanishMove,
  shouldRedirectToGraveyardMove,
  type ContinuousEffectContextFactory,
  type RedirectDestination,
} from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { createRng } from "#engine/rng.js";
import type { DuelEventPayload } from "#duel/event-history.js";
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
  if (redirectLocation && redirectLocation.location !== "graveyard") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason, reasonPlayer);
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Sent to the Graveyard");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason, handlers);
  handlers.collectTrigger(state, "moved", card);
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
  const target = findCard(state, uid);
  if (!target) throw new Error(`Card ${uid} is not in the duel`);
  handlers.collectTrigger(state, "destroying", target);
  const createContext = handlers.createContinuousContext(state);
  const battleRedirectLocation = (reason & duelReason.battle) !== 0 ? battleDestroyRedirectLocation(state, uid, createContext) : undefined;
  if (battleRedirectLocation && battleRedirectLocation.location !== "graveyard") {
    const moveReason = reason | duelReason.redirect;
    requireCoreDuelMoveAllowed(state, uid, battleRedirectLocation.location, moveReason, handlers);
    const card = moveDuelCard(state, uid, battleRedirectLocation.location, controller, moveReason, reasonPlayer);
    applyRedirectDeckSequence(state, card, battleRedirectLocation);
    pushDuelLog(state, "destroy", card.controller, card.name, `Destroyed and moved to ${battleRedirectLocation.location}`);
    collectLeaveFieldTriggers(state, card, handlers);
    collectLeaveGraveyardTriggers(state, card, handlers);
    handlers.collectTrigger(state, "moved", card);
    handlers.collectTrigger(state, "destroyed", card);
    if (battleRedirectLocation.location === "banished") handlers.collectTrigger(state, "banished", card);
    return card;
  }
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason, reasonPlayer);
  pushDuelLog(state, "destroy", card.controller, card.name, "Destroyed");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  handlers.collectTrigger(state, "moved", card);
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
  if (redirectLocation && redirectLocation.location !== "banished") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "banished", reason, handlers);
  const card = moveDuelCard(state, uid, "banished", controller, reason, reasonPlayer);
  pushDuelLog(state, "banish", card.controller, card.name, "Banished");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason, handlers);
  handlers.collectTrigger(state, "moved", card);
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
  const destination = redirectLocation?.location ?? to;
  const moveReason = redirectLocation ? reason | duelReason.redirect : reason;
  requireCoreDuelMoveAllowed(state, uid, destination, moveReason, handlers);
  const card = moveDuelCard(state, uid, destination, controller, moveReason, reasonPlayer);
  applyRedirectDeckSequence(state, card, redirectLocation);
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, moveReason, handlers);
  handlers.collectTrigger(state, "moved", card);
  collectDestinationTriggers(state, card, handlers);
  return card;
}

export function detachCoreDuelOverlayMaterials(
  state: DuelState,
  uid: string,
  count: number,
  controller: PlayerId | undefined,
  reason: number,
  handlers: CoreMovementHandlers,
  reasonPlayer?: PlayerId,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
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
    const material = moveDuelCard(state, materialUid, "graveyard", controller ?? card.controller, reason, reasonPlayer);
    if (payload.eventReasonCardUid !== undefined) material.reasonCardUid = payload.eventReasonCardUid;
    if (payload.eventReasonEffectId !== undefined) material.reasonEffectId = payload.eventReasonEffectId;
    pushDuelLog(state, "detachOverlay", material.controller, material.name, `Detached from ${card.name}`);
    handlers.collectTrigger(state, "moved", material);
    handlers.collectTrigger(state, "sentToGraveyard", material);
    handlers.collectTrigger(state, "detachedMaterial", material);
    detached.push(material);
  }
  return detached;
}

function moveCoreDuelCardToRedirectedLocation(
  state: DuelState,
  uid: string,
  redirect: RedirectDestination,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  if (redirect.location === "graveyard") return sendCoreDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  if (redirect.location === "banished") return banishCoreDuelCard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  const card = moveDuelCard(state, uid, redirect.location, controller, reason | duelReason.redirect, reasonPlayer);
  applyRedirectDeckSequence(state, card, redirect);
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason | duelReason.redirect, handlers);
  handlers.collectTrigger(state, "moved", card);
  collectDestinationTriggers(state, card, handlers);
  return card;
}

function applyRedirectDeckSequence(state: DuelState, card: DuelCardInstance, redirect: RedirectDestination | undefined): void {
  if (card.location !== "deck") return;
  if (redirect?.deckSequence === 1) moveDeckCardToBottom(state, card);
  else if (redirect?.deckSequence === 2) shuffleDeck(state, card.controller);
}

function moveDeckCardToBottom(state: DuelState, card: DuelCardInstance): void {
  const cards = getCards(state, card.controller, "deck").filter((candidate) => candidate.uid !== card.uid);
  cards.push(card);
  for (const [sequence, candidate] of cards.entries()) candidate.sequence = sequence;
}

function shuffleDeck(state: DuelState, player: PlayerId): void {
  const cards = getCards(state, player, "deck");
  const shuffled = [...cards];
  const rng = createRng(`${state.seed}:redirect-shuffle-deck:${player}:${state.randomCounter}`);
  state.randomCounter += 1;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function requireCoreDuelMoveAllowed(state: DuelState, uid: string, to: DuelLocation, reason: number, handlers: CoreMovementHandlers): void {
  if (!handlers.canMoveCardToLocation(state, uid, to, reason)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

function collectLeaveFieldTriggers(state: DuelState, card: DuelCardInstance, handlers: CoreMovementHandlers): void {
  if (card.previousLocation !== "monsterZone" && card.previousLocation !== "spellTrapZone") return;
  if (card.location === "monsterZone" || card.location === "spellTrapZone") return;
  handlers.collectTrigger(state, "leftField", card);
}

function collectLeaveGraveyardTriggers(state: DuelState, card: DuelCardInstance, handlers: CoreMovementHandlers): void {
  if (card.previousLocation === "graveyard" && card.location !== "graveyard") handlers.collectTrigger(state, "leftGraveyard", card);
}

function collectReasonTriggers(state: DuelState, card: DuelCardInstance, reason: number, handlers: CoreMovementHandlers): void {
  if ((reason & duelReason.release) !== 0) handlers.collectTrigger(state, "released", card);
  if ((reason & duelReason.discard) !== 0) handlers.collectTrigger(state, "discarded", card);
}

function collectDestinationTriggers(state: DuelState, card: DuelCardInstance, handlers: CoreMovementHandlers): void {
  if (card.location === "hand") handlers.collectTrigger(state, "sentToHand", card);
  if (card.location === "deck") handlers.collectTrigger(state, "sentToDeck", card);
}
