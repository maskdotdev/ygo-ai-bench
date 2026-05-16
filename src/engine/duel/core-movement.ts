import { findCard, getCards, hasZoneSpace, moveDuelCard, pushDuelLog, resequence } from "#duel/card-state.js";
import {
  battleDestroyRedirectLocation,
  findToGraveCallbackRedirectEffect,
  isReleasePrevented,
  leaveFieldRedirectLocation,
  moveDestinationRedirectLocation,
  setControlPlayerForCard,
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
  findApplicableDestroySubstitutes,
  markDestroySubstitutesUsed,
  type ReplacementEffectHandlers,
} from "#duel/replacement-effects.js";
import type { ContinuousEffectMatch } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelEventName, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export interface CoreMovementHandlers {
  canMoveCardToLocation(state: DuelState, uid: string, to: DuelLocation, reason: number): boolean;
  collectTrigger(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, options?: DuelEventPayload): void;
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
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance {
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, handlers.createContinuousContext(state))) throw new Error(`Card ${uid} cannot be released`);
  const replacementHandlers = handlers.createReplacementHandlers(state);
  const replacement = applyReleaseReplacement(state, uid, controller, reason, reasonPlayer, replacementHandlers, payload);
  if (replacement) return replacement;
  const sendReplacement = applySendReplacement(state, uid, controller, reason, reasonPlayer, replacementHandlers, payload);
  if (sendReplacement) return sendReplacement;
  const createContext = handlers.createContinuousContext(state);
  const callbackRedirect = applyToGraveCallbackRedirect(state, uid, controller, reason, reasonPlayer, handlers);
  if (callbackRedirect) return callbackRedirect;
  if (shouldRedirectToGraveyardMove(state, uid, createContext)) return banishCoreDuelCard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "graveyard", createContext);
  if (redirectLocation && redirectLocation.location !== "graveyard") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, "graveyard", controller, reason, reasonPlayer, createContext);
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Sent to the Graveyard");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason, handlers);
  handlers.collectTrigger(state, "moved", card);
  handlers.collectTrigger(state, "sentToGraveyard", card);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
  return card;
}

export function destroyCoreDuelCard(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
  destination: DuelLocation = "graveyard",
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance {
  const replacementHandlers = handlers.createReplacementHandlers(state);
  const indestructible = applyDestroyPrevention(state, uid, controller, reason, reasonPlayer, replacementHandlers, payload);
  if (indestructible) return indestructible;
  const substituteMatches = findApplicableDestroySubstitutes(state, uid, reason, reasonPlayer, replacementHandlers, payload);
  if (substituteMatches.length > 0) return applyDestroySubstitutes(state, uid, controller, substituteMatches, handlers);
  const replacement = applyDestroyReplacement(state, uid, controller, reason, reasonPlayer, replacementHandlers, payload);
  if (replacement) return replacement;
  const target = findCard(state, uid);
  if (!target) throw new Error(`Card ${uid} is not in the duel`);
  const destroyPayload = { eventReason: reason, eventReasonPlayer: reasonPlayer ?? target.controller, ...payload };
  handlers.collectTrigger(state, "destroying", target, destroyPayload);
  const createContext = handlers.createContinuousContext(state);
  const battleRedirectLocation = (reason & duelReason.battle) !== 0 ? battleDestroyRedirectLocation(state, uid, createContext) : undefined;
  if (battleRedirectLocation && battleRedirectLocation.location !== "graveyard") {
    const moveReason = reason | duelReason.redirect;
    requireCoreDuelMoveAllowed(state, uid, battleRedirectLocation.location, moveReason, handlers);
    const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, battleRedirectLocation.location, controller, moveReason, reasonPlayer, createContext);
    assignReasonPayload(card, payload);
    applyRedirectDeckSequence(state, card, battleRedirectLocation);
    pushDuelLog(state, "destroy", card.controller, card.name, `Destroyed and moved to ${battleRedirectLocation.location}`);
    collectLeaveFieldTriggers(state, card, handlers);
    collectLeaveGraveyardTriggers(state, card, handlers);
    handlers.collectTrigger(state, "moved", card);
    handlers.collectTrigger(state, "destroyed", card);
    if (battleRedirectLocation.location === "banished") handlers.collectTrigger(state, "banished", card);
    applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
    return card;
  }
  if (destination !== "graveyard") {
    const redirectLocation = moveDestinationRedirectLocation(state, uid, destination, createContext) ?? leaveFieldRedirectLocation(state, uid, destination, createContext);
    const moveDestination = redirectLocation?.location ?? destination;
    const moveReason = redirectLocation ? reason | duelReason.redirect : reason;
    requireCoreDuelMoveAllowed(state, uid, moveDestination, moveReason, handlers);
    const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, moveDestination, controller, moveReason, reasonPlayer, createContext);
    assignReasonPayload(card, payload);
    applyRedirectDeckSequence(state, card, redirectLocation);
    pushDuelLog(state, "destroy", card.controller, card.name, `Destroyed and moved to ${moveDestination}`);
    collectLeaveFieldTriggers(state, card, handlers);
    collectLeaveGraveyardTriggers(state, card, handlers);
    handlers.collectTrigger(state, "moved", card);
    handlers.collectTrigger(state, "destroyed", card);
    collectDestroyedDestinationTriggers(state, card, handlers);
    applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
    return card;
  }
  const callbackRedirect = applyToGraveCallbackRedirect(state, uid, controller, reason, reasonPlayer, handlers);
  if (callbackRedirect) {
    assignReasonPayload(callbackRedirect, payload);
    handlers.collectTrigger(state, "destroyed", callbackRedirect);
    return callbackRedirect;
  }
  requireCoreDuelMoveAllowed(state, uid, "graveyard", reason, handlers);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, "graveyard", controller, reason, reasonPlayer, createContext);
  assignReasonPayload(card, payload);
  pushDuelLog(state, "destroy", card.controller, card.name, "Destroyed");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  handlers.collectTrigger(state, "moved", card);
  handlers.collectTrigger(state, "destroyed", card);
  handlers.collectTrigger(state, "sentToGraveyard", card);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
  return card;
}

function assignReasonPayload(card: DuelCardInstance, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">): void {
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
}

function applyDestroySubstitutes(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  matches: ContinuousEffectMatch[],
  handlers: CoreMovementHandlers,
): DuelCardInstance {
  const target = findCard(state, uid);
  if (!target) throw new Error(`Card ${uid} is not in the duel`);
  const destroyedSourceUids = new Set<string>();
  markDestroySubstitutesUsed(state, matches);
  for (const match of matches) {
    if (destroyedSourceUids.has(match.source.uid)) continue;
    destroyedSourceUids.add(match.source.uid);
    destroyCoreDuelCard(state, match.source.uid, match.source.controller, duelReason.effect | duelReason.destroy | duelReason.replace, match.source.controller, handlers);
  }
  pushDuelLog(state, "destroySubstitute", controller ?? target.controller, target.name, "Destruction substituted");
  return target;
}

function moveDuelCardWithLostTargetCapture(
  state: DuelState,
  uid: string,
  to: DuelLocation,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  createContext: ContinuousEffectContextFactory,
): { card: DuelCardInstance; lostTargetEquipUids: string[]; controlReturnTargetUids: string[] } {
  const lostTargetEquipUids = lostTargetEquipUidsForMove(state, uid, to);
  const controlReturnTargetUids = setControlReturnTargetUidsForMove(state, uid, to, createContext);
  const card = moveDuelCard(state, uid, to, controller, reason, reasonPlayer);
  return { card, lostTargetEquipUids, controlReturnTargetUids };
}

function lostTargetEquipUidsForMove(state: DuelState, uid: string, to: DuelLocation): string[] {
  const card = findCard(state, uid);
  if (!card || card.location !== "monsterZone" || to === "monsterZone") return [];
  return state.cards.filter((candidate) => candidate.location === "spellTrapZone" && candidate.equippedToUid === uid).map((candidate) => candidate.uid);
}

function setControlReturnTargetUidsForMove(state: DuelState, uid: string, to: DuelLocation, createContext: ContinuousEffectContextFactory): string[] {
  const source = findCard(state, uid);
  if (!source || source.location !== "spellTrapZone" || to === "spellTrapZone" || source.equippedToUid === undefined) return [];
  const target = findCard(state, source.equippedToUid);
  if (!target || setControlPlayerForCard(state, target, createContext, source.uid) === undefined) return [];
  return [target.uid];
}

function applyPostMoveSideEffects(state: DuelState, lostTargetEquipUids: string[], controlReturnTargetUids: string[], handlers: CoreMovementHandlers): void {
  returnContinuousSetControlTargets(state, controlReturnTargetUids, handlers);
  sendLostTargetEquipsToGraveyard(state, lostTargetEquipUids, handlers);
}

function returnContinuousSetControlTargets(state: DuelState, targetUids: string[], handlers: CoreMovementHandlers): void {
  for (const uid of new Set(targetUids)) {
    const target = findCard(state, uid);
    if (!target || target.location !== "monsterZone") continue;
    const activePlayer = setControlPlayerForCard(state, target, handlers.createContinuousContext(state));
    const returnPlayer = activePlayer ?? target.previousController ?? target.owner;
    if (returnPlayer !== 0 && returnPlayer !== 1) continue;
    if (target.controller === returnPlayer) continue;
    if (!hasZoneSpace(state, returnPlayer, target.location)) continue;
    const previousController = target.controller;
    moveDuelCard(state, target.uid, target.location, returnPlayer, duelReason.return, previousController);
    resequence(state, previousController, target.location);
    pushDuelLog(state, "control", returnPlayer, target.name, `Returned control to player ${returnPlayer}`);
    handlers.collectTrigger(state, "controlChanged", target);
  }
}

function sendLostTargetEquipsToGraveyard(state: DuelState, equipUids: string[], handlers: CoreMovementHandlers): void {
  for (const uid of new Set(equipUids)) {
    const equip = findCard(state, uid);
    if (!equip || equip.location !== "spellTrapZone") continue;
    sendCoreDuelCardToGraveyard(state, equip.uid, equip.controller, duelReason.lostTarget, equip.controller, handlers);
  }
}

export function banishCoreDuelCard(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance {
  const createContext = handlers.createContinuousContext(state);
  if (shouldRedirectBanishMove(state, uid, createContext)) return sendCoreDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect, reasonPlayer, handlers, payload);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "banished", createContext);
  if (redirectLocation && redirectLocation.location !== "banished") return moveCoreDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason, reasonPlayer, handlers);
  requireCoreDuelMoveAllowed(state, uid, "banished", reason, handlers);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, "banished", controller, reason, reasonPlayer, createContext);
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
  pushDuelLog(state, "banish", card.controller, card.name, "Banished");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason, handlers);
  handlers.collectTrigger(state, "moved", card);
  handlers.collectTrigger(state, "banished", card);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
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
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {},
): DuelCardInstance {
  const createContext = handlers.createContinuousContext(state);
  const redirectLocation = moveDestinationRedirectLocation(state, uid, to, createContext) ?? leaveFieldRedirectLocation(state, uid, to, createContext);
  const destination = redirectLocation?.location ?? to;
  const moveReason = redirectLocation ? reason | duelReason.redirect : reason;
  requireCoreDuelMoveAllowed(state, uid, destination, moveReason, handlers);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, destination, controller, moveReason, reasonPlayer, createContext);
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
  applyRedirectDeckSequence(state, card, redirectLocation);
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, moveReason, handlers);
  handlers.collectTrigger(state, "moved", card);
  collectDestinationTriggers(state, card, handlers);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
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
  const createContext = handlers.createContinuousContext(state);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, redirect.location, controller, reason | duelReason.redirect, reasonPlayer, createContext);
  applyRedirectDeckSequence(state, card, redirect);
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, reason | duelReason.redirect, handlers);
  handlers.collectTrigger(state, "moved", card);
  collectDestinationTriggers(state, card, handlers);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
  return card;
}

function applyToGraveCallbackRedirect(
  state: DuelState,
  uid: string,
  controller: PlayerId | undefined,
  reason: number,
  reasonPlayer: PlayerId | undefined,
  handlers: CoreMovementHandlers,
): DuelCardInstance | undefined {
  const createContext = handlers.createContinuousContext(state);
  const match = findToGraveCallbackRedirectEffect(state, uid, reason, reasonPlayer, createContext);
  if (!match) return undefined;
  const moveReason = reason | duelReason.redirect;
  requireCoreDuelMoveAllowed(state, uid, "spellTrapZone", moveReason, handlers);
  const { card, lostTargetEquipUids, controlReturnTargetUids } = moveDuelCardWithLostTargetCapture(state, uid, "spellTrapZone", controller, moveReason, reasonPlayer, createContext);
  const ctx = createContext(match.effect, match.source, card, { checkOnly: false, eventReason: moveReason, eventReasonPlayer: reasonPlayer ?? card.controller, eventDestination: "graveyard" });
  match.effect.operation?.(ctx);
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Redirected to the Spell/Trap Zone");
  collectLeaveFieldTriggers(state, card, handlers);
  collectLeaveGraveyardTriggers(state, card, handlers);
  collectReasonTriggers(state, card, moveReason, handlers);
  handlers.collectTrigger(state, "moved", card);
  applyPostMoveSideEffects(state, lostTargetEquipUids, controlReturnTargetUids, handlers);
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
  if (card.location === "deck" || card.location === "extraDeck") handlers.collectTrigger(state, "sentToDeck", card);
}

function collectDestroyedDestinationTriggers(state: DuelState, card: DuelCardInstance, handlers: CoreMovementHandlers): void {
  if (card.location === "graveyard") handlers.collectTrigger(state, "sentToGraveyard", card);
  else if (card.location === "banished") handlers.collectTrigger(state, "banished", card);
  else collectDestinationTriggers(state, card, handlers);
}
