import { shuffle } from "#engine/rng.js";
import {
  createDuelActivityCounts,
  recordSpecialSummonActivity,
  resetDuelActivityCounts,
} from "#duel/activity.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import {
  findCard,
  canMoveDuelCardToLocation as canMoveDuelCardToLocationRule,
  getCards,
  hasZoneSpace,
  moveDuelCard,
  pushDuelLog,
  requireControlledCard,
  requireZoneSpace,
  resequence,
} from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import {
  flipSummonActions,
  flipSummonDuelCard as flipSummonDuelCardWithEvents,
  fusionSummonActions,
  fusionSummonDuelCard as fusionSummonDuelCardWithEvents,
  linkSummonActions,
  linkSummonDuelCard as linkSummonDuelCardWithEvents,
  normalSummon,
  normalSummonActions,
  ritualSummonActions,
  ritualSummonDuelCard as ritualSummonDuelCardWithEvents,
  setMonster,
  synchroSummonActions,
  synchroSummonDuelCard as synchroSummonDuelCardWithEvents,
  tributeSummonActions,
  tributeSummonDuelCard as tributeSummonDuelCardWithEvents,
  type DuelMaterialMover,
  type DuelMaterialPredicate,
  type DuelOverlayMaterialMover,
  xyzSummonActions,
  xyzSummonDuelCard as xyzSummonDuelCardWithEvents,
} from "#duel/summon.js";
import {
  attackActions,
  canChangeDuelCardPosition as canChangeDuelCardPositionRule,
  canDuelCardAttack as canDuelCardAttackRule,
  changeDuelCardPosition as changeDuelCardPositionRule,
  declareDuelAttack as declareDuelAttackRule,
  getDuelAttackTargets as getDuelAttackTargetsRule,
  positionChangeActions,
} from "#duel/battle.js";
import {
  isAttackPrevented,
  isMaterialUsePrevented,
  isMoveToLocationPrevented,
  isReleasePrevented,
  isSpecialSummonPrevented,
  leaveFieldRedirectLocation,
  moveDestinationRedirectLocation,
  shouldRedirectBanishMove,
  shouldRedirectToGraveyardMove,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import {
  applyDestroyPrevention,
  applyDestroyReplacement,
  applyReleaseReplacement,
  applySendReplacement,
  type ReplacementEffectHandlers,
} from "#duel/replacement-effects.js";
import { sameAction } from "#duel/response-match.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  ChainLimit,
  ChainLink,
  DuelAction,
  DuelCardInstance,
  DuelCardReader,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelEventName,
  DuelLocation,
  DuelOptions,
  DuelPhase,
  DuelPlayerDeck,
  DuelPromptState,
  DuelResponse,
  DuelSession,
  DuelState,
  PendingTrigger,
  PlayerId,
} from "#duel/types.js";
import { queryPublicState } from "#duel/snapshot.js";

export { moveDuelCard } from "#duel/card-state.js";
export { queryPublicState, serializeDuel, restoreDuel } from "#duel/snapshot.js";

const phaseOrder: DuelPhase[] = ["draw", "standby", "main1", "battle", "main2", "end"];

export interface CreateDuelOptions extends DuelOptions {
  cardReader?: DuelCardReader;
}

export function createDuel(options: CreateDuelOptions = {}): DuelSession {
  const seed = String(options.seed ?? Date.now());
  const state: DuelState = {
    id: `duel-${seed}-${Date.now().toString(36)}`,
    seed,
    status: "setup",
    turn: 0,
    turnPlayer: 0,
    phase: "draw",
    players: {
      0: { id: 0, lifePoints: options.startingLifePoints ?? 8000, normalSummonAvailable: true },
      1: { id: 1, lifePoints: options.startingLifePoints ?? 8000, normalSummonAvailable: true },
    },
    cards: [],
    effects: [],
    chain: [],
    chainLimits: [],
    chainPasses: [],
    pendingTriggers: [],
    usedCountKeys: [],
    flagEffects: [],
    activityCounts: createDuelActivityCounts(),
    attacksDeclared: [],
    positionsChanged: [],
    log: [],
    options: {
      startingLifePoints: options.startingLifePoints ?? 8000,
      startingHandSize: options.startingHandSize ?? 5,
      drawPerTurn: options.drawPerTurn ?? 1,
    },
  };
  return { state, cardReader: options.cardReader ?? fallbackCardReader };
}

export function loadDecks(session: DuelSession, decks: Record<PlayerId, DuelPlayerDeck>): void {
  if (session.state.status !== "setup") throw new Error("Decks can only be loaded before the duel starts");
  session.state.cards = [];
  for (const player of [0, 1] satisfies PlayerId[]) {
    const deck = decks[player];
    instantiateDeck(session, player, "deck", deck.main);
    instantiateDeck(session, player, "extraDeck", deck.extra ?? []);
    resequence(session.state, player, "deck");
    resequence(session.state, player, "extraDeck");
  }
}

export function startDuel(session: DuelSession): void {
  if (session.state.status !== "setup") throw new Error("Duel has already started");
  for (const player of [0, 1] satisfies PlayerId[]) {
    const deck = getCards(session.state, player, "deck");
    const shuffled = shuffle(deck, `${session.state.seed}:${player}`);
    for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
    draw(session.state, player, session.state.options.startingHandSize, "Opening hand");
  }
  session.state.status = "awaiting";
  session.state.turn = 1;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  pushDuelLog(session.state, "startDuel", undefined, undefined, "Duel started");
}

export function registerEffect(session: DuelSession, effect: DuelEffectDefinition): void {
  session.state.effects.push(effect);
}

export function getLegalActions(session: DuelSession, player: PlayerId): DuelAction[] {
  const { state } = session;
  if (state.status !== "awaiting" || state.waitingFor !== player) return [];
  const actions: DuelAction[] = [];
  if (state.prompt) {
    actions.push(...getPromptResponseActions(state.prompt, player));
    return actions;
  }
  if (state.chain.length) {
    actions.push(...getChainResponseActions(state, player));
    return actions;
  }
  if (state.pendingTriggers.length) {
    for (const trigger of state.pendingTriggers.filter((candidate) => candidate.player === player)) {
      const source = findCard(state, trigger.sourceUid);
      if (!source) continue;
      actions.push({ type: "activateTrigger", player, triggerId: trigger.id, uid: source.uid, effectId: trigger.effectId, label: `${source.name}: ${trigger.effectId}` });
      actions.push({ type: "declineTrigger", player, triggerId: trigger.id, uid: source.uid, effectId: trigger.effectId, label: `Decline ${source.name}: ${trigger.effectId}` });
    }
    return actions;
  }
  const hand = getCards(state, player, "hand");
  if (state.phase === "main1" || state.phase === "main2") {
    actions.push(...normalSummonActions(state, player, hand));
    actions.push(...tributeSummonActions(state, player, hand, createReleasePredicate(state, duelReason.release | duelReason.summon)));
    actions.push(...fusionSummonActions(state, player, createMaterialUsePredicate(state, "fusion")));
    actions.push(...synchroSummonActions(state, player, createMaterialUsePredicate(state, "synchro")));
    actions.push(...xyzSummonActions(state, player, (uid) => !isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state))));
    actions.push(...linkSummonActions(state, player, createMaterialUsePredicate(state, "link")));
    actions.push(...ritualSummonActions(state, player, hand, createMaterialUsePredicate(state, "ritual")));
    actions.push(...specialSummonProcedureActions(state, player));
    if (hasZoneSpace(state, player, "spellTrapZone")) {
      for (const card of hand.filter((candidate) => candidate.kind === "spell" || candidate.kind === "trap")) {
        actions.push({ type: "setSpellTrap", player, uid: card.uid, label: `Set ${card.name}` });
      }
    }
    for (const effect of state.effects) {
      if (effect.controller !== player) continue;
      if (effect.event !== "ignition" && effect.event !== "quick") continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (!canUseEffectCount(state, effect)) continue;
      if (!canChooseEffect(state, effect, source, player)) continue;
      actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
    }
    actions.push(...positionChangeActions(state, player));
    actions.push(...flipSummonActions(state, player));
  }
  if (state.phase === "battle") {
    for (const action of attackActions(state, player)) {
      if (action.type !== "declareAttack") continue;
      const attacker = findCard(state, action.attackerUid);
      if (attacker && !isAttackPrevented(state, attacker, createContinuousEffectContext(state))) actions.push(action);
    }
  }
  const nextPhase = phaseOrder[phaseOrder.indexOf(state.phase) + 1];
  if (nextPhase) actions.push({ type: "changePhase", player, phase: nextPhase, label: `Go to ${nextPhase}` });
  actions.push({ type: "endTurn", player, label: "End turn" });
  return actions;
}

export function applyResponse(session: DuelSession, response: DuelResponse): ApplyDuelResponseResult {
  const legal = getLegalActions(session, response.player);
  const isLegal = legal.some((action) => sameAction(action, response));
  if (!isLegal) return result(session, false, "Response is not currently legal");

  try {
    if (response.type === "normalSummon") normalSummon(session.state, response.player, response.uid, (eventName, eventCard) => collectTriggerEffects(session.state, eventName, eventCard));
    else if (response.type === "tributeSummon") tributeSummonDuelCard(session.state, response.player, response.uid, response.tributeUids);
    else if (response.type === "fusionSummon") fusionSummonDuelCard(session.state, response.player, response.uid, response.materialUids);
    else if (response.type === "synchroSummon") synchroSummonDuelCard(session.state, response.player, response.uid, response.materialUids);
    else if (response.type === "xyzSummon") xyzSummonDuelCard(session.state, response.player, response.uid, response.materialUids);
    else if (response.type === "linkSummon") linkSummonDuelCard(session.state, response.player, response.uid, response.materialUids);
    else if (response.type === "ritualSummon") ritualSummonDuelCard(session.state, response.player, response.uid, response.materialUids);
    else if (response.type === "specialSummonProcedure") specialSummonByProcedure(session, response.player, response.uid, response.effectId);
    else if (response.type === "setMonster") setMonster(session.state, response.player, response.uid);
    else if (response.type === "setSpellTrap") setSpellTrap(session.state, response.player, response.uid);
    else if (response.type === "activateEffect") activateEffect(session, response.player, response.uid, response.effectId);
    else if (response.type === "passChain") passChain(session.state, response.player);
    else if (response.type === "selectOption" || response.type === "selectYesNo") resolvePrompt(session.state, response);
    else if (response.type === "activateTrigger") activatePendingTrigger(session, response.player, response.triggerId);
    else if (response.type === "declineTrigger") declinePendingTrigger(session, response.player, response.triggerId);
    else if (response.type === "flipSummon") flipSummonDuelCard(session.state, response.player, response.uid);
    else if (response.type === "changePosition") changeDuelCardPosition(session.state, response.player, response.uid, response.position);
    else if (response.type === "declareAttack") declareDuelAttack(session.state, response.player, response.attackerUid, response.targetUid);
    else if (response.type === "changePhase") changePhase(session.state, response.player, response.phase);
    else if (response.type === "endTurn") endTurn(session.state, response.player);
    return result(session, true);
  } catch (error) {
    return result(session, false, error instanceof Error ? error.message : "Unknown duel engine error");
  }
}

export function specialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const summonController = controller ?? card.controller;
  requireZoneSpace(state, summonController, "monsterZone");
  if (!canSpecialSummonDuelCard(state, uid, summonController)) throw new Error(`${card.name} cannot be Special Summoned`);
  moveDuelCard(state, uid, "monsterZone", summonController, duelReason.summon | duelReason.specialSummon);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "special";
  recordSpecialSummonActivity(state, summonController);
  pushDuelLog(state, "specialSummon", card.controller, card.name, "Special Summoned");
  collectTriggerEffects(state, "specialSummoned", card);
  return card;
}

export function canSpecialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): boolean {
  const card = findCard(state, uid);
  if (!card || !isMonsterLike(card)) return false;
  const summonController = controller ?? card.controller;
  if (isSpecialSummonPrevented(state, summonController, createContinuousEffectContext(state), card)) return false;
  if (!hasZoneSpace(state, summonController, "monsterZone")) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

function canAttemptSpecialSummonProcedure(state: DuelState, uid: string): boolean {
  const card = findCard(state, uid);
  if (!card || !isMonsterLike(card)) return false;
  if (isSpecialSummonPrevented(state, card.controller, createContinuousEffectContext(state), card)) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

export function canPlayerSpecialSummon(state: DuelState, player: PlayerId, card?: DuelCardInstance): boolean {
  return !isSpecialSummonPrevented(state, player, createContinuousEffectContext(state), card);
}

export function canMoveDuelCardToLocation(state: DuelState, uid: string, to: DuelLocation, reason: number = duelReason.effect): boolean {
  if (!canMoveDuelCardToLocationRule(state, uid, to)) return false;
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, createContinuousEffectContext(state))) return false;
  return !isMoveToLocationPrevented(state, uid, to, reason, createContinuousEffectContext(state));
}

function requireDuelMoveAllowed(state: DuelState, uid: string, to: DuelLocation, reason: number): void {
  if (!canMoveDuelCardToLocation(state, uid, to, reason)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

export function sendDuelCardToGraveyard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect): DuelCardInstance {
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, createContinuousEffectContext(state))) throw new Error(`Card ${uid} cannot be released`);
  const replacementHandlers = createReplacementEffectHandlers(state);
  const replacement = applyReleaseReplacement(state, uid, controller, reason, replacementHandlers);
  if (replacement) return replacement;
  const sendReplacement = applySendReplacement(state, uid, controller, reason, replacementHandlers);
  if (sendReplacement) return sendReplacement;
  const createContext = createContinuousEffectContext(state);
  if (shouldRedirectToGraveyardMove(state, uid, createContext)) return banishDuelCard(state, uid, controller, reason | duelReason.redirect);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "graveyard", createContext);
  if (redirectLocation && redirectLocation !== "graveyard") return moveDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason);
  requireDuelMoveAllowed(state, uid, "graveyard", reason);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason);
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Sent to the Graveyard");
  collectTriggerEffects(state, "sentToGraveyard", card);
  return card;
}

export function destroyDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect | duelReason.destroy): DuelCardInstance {
  const replacementHandlers = createReplacementEffectHandlers(state);
  const indestructible = applyDestroyPrevention(state, uid, controller, reason, replacementHandlers);
  if (indestructible) return indestructible;
  const replacement = applyDestroyReplacement(state, uid, controller, reason, replacementHandlers);
  if (replacement) return replacement;
  requireDuelMoveAllowed(state, uid, "graveyard", reason);
  const card = moveDuelCard(state, uid, "graveyard", controller, reason);
  pushDuelLog(state, "destroy", card.controller, card.name, "Destroyed");
  collectTriggerEffects(state, "sentToGraveyard", card);
  return card;
}

export function banishDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect): DuelCardInstance {
  const createContext = createContinuousEffectContext(state);
  if (shouldRedirectBanishMove(state, uid, createContext)) return sendDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect);
  const redirectLocation = leaveFieldRedirectLocation(state, uid, "banished", createContext);
  if (redirectLocation && redirectLocation !== "banished") return moveDuelCardToRedirectedLocation(state, uid, redirectLocation, controller, reason);
  requireDuelMoveAllowed(state, uid, "banished", reason);
  const card = moveDuelCard(state, uid, "banished", controller, reason);
  pushDuelLog(state, "banish", card.controller, card.name, "Banished");
  collectTriggerEffects(state, "banished", card);
  return card;
}

export function moveDuelCardWithRedirects(state: DuelState, uid: string, to: DuelLocation, controller?: PlayerId, reason: number = duelReason.effect): DuelCardInstance {
  const createContext = createContinuousEffectContext(state);
  const redirectLocation = moveDestinationRedirectLocation(state, uid, to, createContext) ?? leaveFieldRedirectLocation(state, uid, to, createContext);
  const destination = redirectLocation ?? to;
  const moveReason = redirectLocation ? reason | duelReason.redirect : reason;
  requireDuelMoveAllowed(state, uid, destination, moveReason);
  return moveDuelCard(state, uid, destination, controller, moveReason);
}

export function detachDuelOverlayMaterials(state: DuelState, uid: string, count: number, controller?: PlayerId, reason: number = duelReason.cost): DuelCardInstance[] {
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
    collectTriggerEffects(state, "sentToGraveyard", material);
    detached.push(material);
  }
  return detached;
}

export function damageDuelPlayer(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints - value);
  pushDuelLog(state, "damage", player, undefined, String(value));
  if (state.players[player].lifePoints <= 0) state.status = "ended";
  return value;
}

export function recoverDuelPlayer(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints += value;
  pushDuelLog(state, "recover", player, undefined, String(value));
  return value;
}

export function setDuelPlayerLifePoints(state: DuelState, player: PlayerId, lifePoints: number): void {
  state.players[player].lifePoints = Math.max(0, Math.floor(lifePoints));
  pushDuelLog(state, "setLifePoints", player, undefined, String(state.players[player].lifePoints));
  if (state.players[player].lifePoints <= 0) state.status = "ended";
}

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void {
  tributeSummonDuelCardWithEvents(
    state,
    player,
    uid,
    tributeUids,
    (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
    createMaterialMover(state),
    createReleasePredicate(state, duelReason.release | duelReason.summon),
  );
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string): DuelCardInstance {
  return flipSummonDuelCardWithEvents(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function fusionSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return fusionSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "fusion"));
}

export function synchroSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return synchroSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "synchro"));
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return xyzSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createOverlayMaterialMover(state));
}

export function linkSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return linkSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "link"));
}

export function ritualSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return ritualSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "ritual"));
}

function createMaterialMover(state: DuelState): DuelMaterialMover {
  return (uid, controller, reason) => {
    const card = sendDuelCardToGraveyard(state, uid, controller, reason);
    return { card, collectedSentToGraveyard: card.location === "graveyard" };
  };
}

function createOverlayMaterialMover(state: DuelState): DuelOverlayMaterialMover {
  return (uid, controller, reason) => {
    if (isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state))) throw new Error(`Card ${uid} cannot be used as Xyz material`);
    requireDuelMoveAllowed(state, uid, "overlay", reason);
    return moveDuelCard(state, uid, "overlay", controller, reason);
  };
}

function createMaterialUsePredicate(state: DuelState, kind: "fusion" | "synchro" | "xyz" | "link" | "ritual"): DuelMaterialPredicate {
  return (uid) => !isMaterialUsePrevented(state, uid, kind, createContinuousEffectContext(state));
}

function createReleasePredicate(state: DuelState, reason: number): DuelMaterialPredicate {
  return (uid) => !isReleasePrevented(state, uid, reason, createContinuousEffectContext(state));
}

export function drawDuelCards(state: DuelState, player: PlayerId, count: number, detail = "Effect draw"): number {
  return draw(state, player, Math.max(0, count), detail);
}

export function canDuelCardAttack(state: DuelState, uid: string): boolean {
  const card = findCard(state, uid);
  return Boolean(card && !isAttackPrevented(state, card, createContinuousEffectContext(state)) && canDuelCardAttackRule(state, uid));
}

export function getDuelAttackTargets(state: DuelState, attackerUid: string): DuelCardInstance[] {
  const card = findCard(state, attackerUid);
  if (!card || isAttackPrevented(state, card, createContinuousEffectContext(state))) return [];
  return getDuelAttackTargetsRule(state, attackerUid);
}

export function declareDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid?: string): void {
  const attacker = findCard(state, attackerUid);
  if (attacker && isAttackPrevented(state, attacker, createContinuousEffectContext(state))) throw new Error(`${attacker.name} cannot attack`);
  declareDuelAttackRule(state, player, attackerUid, targetUid, {
    collectEvent: (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount) => damageDuelPlayer(state, damagedPlayer, amount),
    destroyCard: (uid, controller, reason) => destroyDuelCard(state, uid, controller, reason),
  });
}

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  return canChangeDuelCardPositionRule(state, uid, position);
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition): DuelCardInstance {
  return changeDuelCardPositionRule(state, player, uid, position, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

function instantiateDeck(session: DuelSession, player: PlayerId, location: DuelLocation, codes: string[]): void {
  for (const [index, code] of codes.entries()) {
    const data = session.cardReader(String(code)) ?? fallbackCardReader(String(code));
    session.state.cards.push({
      uid: `p${player}-${location}-${code}-${index}`,
      code: data.code,
      name: data.name,
      kind: location === "extraDeck" ? "extra" : data.kind,
      owner: player,
      controller: player,
      location,
      sequence: index,
      position: "faceDown" as CardPosition,
      overlayUids: [],
      faceUp: false,
      data,
    });
  }
}

function setSpellTrap(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  requireZoneSpace(state, player, "spellTrapZone");
  moveDuelCard(state, uid, "spellTrapZone", player, duelReason.rule);
  card.position = "faceDown";
  card.faceUp = false;
  pushDuelLog(state, "set", player, card.name, "Set from hand");
}

function activateEffect(session: DuelSession, player: PlayerId, uid: string, effectId: string): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid);
  if (!effect) throw new Error(`Effect ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  const targetUids: string[] = [];
  const ctx = createEffectContext(session.state, source, player, undefined, undefined, targetUids);
  if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
  if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
  pushChainLink(session.state, player, uid, effectId, undefined, undefined, targetUids, ctx.targetPlayer, ctx.targetParam);
  pushDuelLog(session.state, "activate", player, source.name, effect.id);
  markEffectUsed(session.state, effect);
  const responsePlayer = otherPlayer(player);
  if (hasChainResponses(session.state, responsePlayer)) {
    session.state.waitingFor = responsePlayer;
    return;
  }
  resolveChain(session.state);
}

function specialSummonByProcedure(session: DuelSession, player: PlayerId, uid: string, effectId: string): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid && candidate.event === "summonProcedure");
  if (!effect) throw new Error(`Summon procedure ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  if (!effect.range.includes(source.location)) throw new Error(`${source.name} summon procedure is not in range`);
  const ctx = createEffectContext(session.state, source, player);
  if (!canAttemptSpecialSummonProcedure(session.state, uid)) throw new Error(`${source.name} cannot be Special Summoned`);
  if (effect.canActivate && !effect.canActivate(ctx)) throw new Error(`Condition for ${effectId} is not legal`);
  if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
  if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
  if (effect.operation) effect.operation(ctx);
  markEffectUsed(session.state, effect);
  specialSummonDuelCard(session.state, uid, player);
}

function activatePendingTrigger(session: DuelSession, player: PlayerId, triggerId: string): void {
  const trigger = takePendingTrigger(session.state, player, triggerId);
  const effect = session.state.effects.find((candidate) => candidate.sourceUid === trigger.sourceUid && candidate.id === trigger.effectId);
  if (!effect) throw new Error(`Effect ${trigger.effectId} is not registered`);
  const source = findCard(session.state, trigger.sourceUid);
  const eventCard = trigger.eventCardUid === undefined ? undefined : findCard(session.state, trigger.eventCardUid);
  if (!source || (trigger.eventCardUid !== undefined && !eventCard)) throw new Error(`Trigger ${triggerId} lost its source or event card`);
  const targetUids: string[] = [];
  const ctx = createEffectContext(session.state, source, trigger.player, trigger.eventName, eventCard, targetUids);
  if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effect.id} could not be paid`);
  if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effect.id} are not legal`);
  pushChainLink(session.state, trigger.player, source.uid, effect.id, trigger.eventName, eventCard, targetUids, ctx.targetPlayer, ctx.targetParam);
  pushDuelLog(session.state, "trigger", trigger.player, source.name, effect.id);
  markEffectUsed(session.state, effect);
  const responsePlayer = otherPlayer(trigger.player);
  if (hasChainResponses(session.state, responsePlayer)) {
    session.state.waitingFor = responsePlayer;
    return;
  }
  resolveChain(session.state);
}

function declinePendingTrigger(session: DuelSession, player: PlayerId, triggerId: string): void {
  const trigger = takePendingTrigger(session.state, player, triggerId);
  const source = findCard(session.state, trigger.sourceUid);
  pushDuelLog(session.state, "declineTrigger", player, source?.name, trigger.effectId);
  session.state.waitingFor = session.state.pendingTriggers[0]?.player ?? session.state.turnPlayer;
}

function takePendingTrigger(state: DuelState, player: PlayerId, triggerId: string): PendingTrigger {
  const triggerIndex = state.pendingTriggers.findIndex((candidate) => candidate.id === triggerId && candidate.player === player);
  if (triggerIndex < 0) throw new Error(`Trigger ${triggerId} is not pending for player ${player}`);
  const [trigger] = state.pendingTriggers.splice(triggerIndex, 1);
  if (!trigger) throw new Error(`Trigger ${triggerId} is not pending`);
  return trigger;
}

function changePhase(state: DuelState, player: PlayerId, phase: DuelPhase): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can change phases");
  if (phaseOrder.indexOf(phase) <= phaseOrder.indexOf(state.phase)) throw new Error(`Cannot move from ${state.phase} to ${phase}`);
  state.phase = phase;
  if (phase === "battle") state.attacksDeclared = [];
  else delete state.currentAttack;
  pushDuelLog(state, "phase", player, undefined, `Moved to ${phase}`);
  collectTriggerEffects(state, "phaseChanged");
}

function endTurn(state: DuelState, player: PlayerId): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can end the turn");
  state.turn += 1;
  state.turnPlayer = otherPlayer(player);
  state.phase = "draw";
  state.waitingFor = state.turnPlayer;
  state.attacksDeclared = [];
  state.positionsChanged = [];
  for (const activityPlayer of [0, 1] satisfies PlayerId[]) resetDuelActivityCounts(state, activityPlayer);
  delete state.currentAttack;
  state.players[state.turnPlayer].normalSummonAvailable = true;
  draw(state, state.turnPlayer, state.options.drawPerTurn, "Turn draw");
  state.phase = "main1";
  pushDuelLog(state, "turn", state.turnPlayer, undefined, `Turn ${state.turn} started`);
  collectTriggerEffects(state, "turnStarted");
}

function draw(state: DuelState, player: PlayerId, count: number, detail: string): number {
  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    const card = getCards(state, player, "deck").sort((a, b) => a.sequence - b.sequence)[0];
    if (!card) return drawn;
    moveDuelCard(state, card.uid, "hand", player, duelReason.rule);
    pushDuelLog(state, "draw", player, card.name, detail);
    drawn += 1;
  }
  return drawn;
}

function createEffectContext(
  state: DuelState,
  source: DuelCardInstance,
  player: PlayerId,
  eventName?: DuelEventName,
  eventCard?: DuelCardInstance,
  targetUids: string[] = [],
  checkOnly = false,
  activationLocation: DuelLocation = source.location,
  activationSequence: number = source.sequence,
  targetPlayer?: PlayerId,
  targetParam?: number,
  chainLink?: ChainLink,
): DuelEffectContext {
  const ctx: DuelEffectContext = {
    duel: state,
    source,
    player,
    activationLocation,
    activationSequence,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCard }),
    ...(checkOnly ? { checkOnly } : {}),
    targetUids,
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
    ...(chainLink === undefined ? {} : { chainLink }),
    log(detail) {
      pushDuelLog(state, "effect", player, source.name, detail);
    },
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller, duelReason.effect);
    },
    negateChainLink(chainLinkId) {
      return negateDuelChainLink(state, chainLinkId, player, source.name);
    },
    setTargets(uids) {
      targetUids.splice(0, targetUids.length, ...uids);
    },
    getTargets() {
      return targetUids.map((uid) => findCard(state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
    },
    setTargetPlayer(target) {
      ctx.targetPlayer = target;
    },
    setTargetParam(parameter) {
      ctx.targetParam = parameter;
    },
  };
  return ctx;
}

function createContinuousEffectContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => createEffectContext(state, source, effect.controller, undefined, card, [], true);
}

function createReplacementEffectHandlers(state: DuelState): ReplacementEffectHandlers {
  return {
    createContinuousContext: createContinuousEffectContext(state),
    createReplacementContext(effect, source, card, checkOnly) {
      return createEffectContext(state, source, effect.controller, undefined, card, [], checkOnly);
    },
    log(action, player, cardName, detail) {
      pushDuelLog(state, action, player, cardName, detail);
    },
  };
}

function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  for (const effect of state.effects) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (!canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canChooseEffect(state, effect, source, effect.controller, eventName, eventCard)) continue;
    state.pendingTriggers.push(createPendingTrigger(state, effect, source, eventName, eventCard));
  }
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

function createPendingTrigger(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard?: DuelCardInstance): PendingTrigger {
  return {
    id: `trigger-${state.log.length + 1}-${state.pendingTriggers.length + 1}`,
    player: effect.controller,
    sourceUid: source.uid,
    effectId: effect.id,
    eventName,
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
  };
}

function getChainResponseActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions = quickEffectActions(state, player);
  actions.push({ type: "passChain", player, label: "Pass" });
  return actions;
}

function getPromptResponseActions(prompt: DuelPromptState, player: PlayerId): DuelAction[] {
  if (prompt.player !== player) return [];
  if (prompt.type === "selectOption") {
    return prompt.options.map((option) => ({ type: "selectOption", player, promptId: prompt.id, option, label: `Select option ${option}` }));
  }
  return [
    { type: "selectYesNo", player, promptId: prompt.id, yes: true, label: "Yes" },
    { type: "selectYesNo", player, promptId: prompt.id, yes: false, label: "No" },
  ];
}

function resolvePrompt(state: DuelState, response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>): void {
  const prompt = state.prompt;
  if (!prompt || prompt.id !== response.promptId || prompt.player !== response.player || prompt.type !== response.type) throw new Error("Prompt response does not match the pending prompt");
  if (prompt.type === "selectOption") {
    if (response.type !== "selectOption" || !prompt.options.includes(response.option)) throw new Error(`Option ${response.type === "selectOption" ? response.option : ""} is not legal`);
    pushDuelLog(state, "selectOption", response.player, undefined, `Selected option ${response.option}`);
  } else {
    if (response.type !== "selectYesNo") throw new Error("Prompt response does not match the pending prompt");
    pushDuelLog(state, "selectYesNo", response.player, undefined, response.yes ? "Selected yes" : "Selected no");
  }
  state.waitingFor = prompt.returnTo ?? state.turnPlayer;
  delete state.prompt;
}

function quickEffectActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "quick") continue;
    if (!chainLimitsAllow(state, effect, player)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
  }
  return actions;
}

function specialSummonProcedureActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "summonProcedure") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canAttemptSpecialSummonProcedure(state, source.uid)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "specialSummonProcedure", player, uid: source.uid, effectId: effect.id, label: `Special Summon ${source.name}` });
  }
  return actions;
}

function canChooseEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance): boolean {
  const ctx = createEffectContext(state, source, player, eventName, eventCard, [], true);
  if (effect.canActivate && !effect.canActivate(ctx)) return false;
  if (effect.cost && !effect.cost(ctx)) return false;
  if (effect.target && !effect.target(ctx)) return false;
  return true;
}

function moveDuelCardToRedirectedLocation(state: DuelState, uid: string, location: DuelLocation, controller: PlayerId | undefined, reason: number): DuelCardInstance {
  if (location === "graveyard") return sendDuelCardToGraveyard(state, uid, controller, reason | duelReason.redirect);
  if (location === "banished") return banishDuelCard(state, uid, controller, reason | duelReason.redirect);
  return moveDuelCard(state, uid, location, controller, reason | duelReason.redirect);
}

function hasChainResponses(state: DuelState, player: PlayerId): boolean {
  return quickEffectActions(state, player).length > 0;
}

function chainLimitsAllow(state: DuelState, effect: DuelEffectDefinition, player: PlayerId): boolean {
  const link = state.chain[state.chain.length - 1];
  if (!link) return true;
  for (const limit of state.chainLimits) {
    if (!limit.untilChainEnd && limit.expiresAtChainLength !== state.chain.length) continue;
    if (!limit.allows(effect, player, link.player)) return false;
  }
  return true;
}

export function addDuelChainLimit(state: DuelState, limit: Omit<ChainLimit, "expiresAtChainLength">): void {
  state.chainLimits.push({
    ...limit,
    ...(limit.untilChainEnd ? {} : { expiresAtChainLength: state.chain.length + 1 }),
  });
}

function pushChainLink(
  state: DuelState,
  player: PlayerId,
  sourceUid: string,
  effectId: string,
  eventName?: DuelEventName,
  eventCard?: DuelCardInstance,
  targetUids: string[] = [],
  targetPlayer?: PlayerId,
  targetParam?: number,
): void {
  const source = findCard(state, sourceUid);
  state.chain.push({
    id: `chain-${state.log.length + 1}`,
    player,
    sourceUid,
    effectId,
    ...(source === undefined ? {} : { activationLocation: source.location, activationSequence: source.sequence }),
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
    ...(targetUids.length === 0 ? {} : { targetUids: [...targetUids] }),
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
  });
  state.chainPasses = [];
  clearStaleChainLimits(state);
}

function passChain(state: DuelState, player: PlayerId): void {
  if (!state.chain.length) throw new Error("No chain is pending");
  if (!state.chainPasses.includes(player)) state.chainPasses.push(player);
  const nextPlayer = otherPlayer(player);
  if (state.chainPasses.includes(nextPlayer) || !hasChainResponses(state, nextPlayer)) {
    resolveChain(state);
    return;
  }
  state.waitingFor = nextPlayer;
}

function resolveChain(state: DuelState): void {
  state.status = "resolving";
  try {
    while (state.chain.length) {
      const link = state.chain.pop();
      if (!link) continue;
      if (link.negated) {
        pushDuelLog(state, "chainNegated", link.player, undefined, link.effectId);
        continue;
      }
      const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
      const source = findCard(state, link.sourceUid);
      if (!effect || !source) continue;
      const eventCard = link.eventCardUid === undefined ? undefined : findCard(state, link.eventCardUid);
      const ctx = createEffectContext(
        state,
        source,
        link.player,
        link.eventName,
        eventCard,
        [...(link.targetUids ?? [])],
        false,
        link.activationLocation ?? source.location,
        link.activationSequence ?? source.sequence,
        link.targetPlayer,
        link.targetParam,
        link,
      );
      effect.operation(ctx);
    }
  } finally {
    clearChainLimits(state);
  }
  state.chainPasses = [];
  state.status = "awaiting";
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

function clearStaleChainLimits(state: DuelState): void {
  clearChainLimits(state, (limit) => !limit.untilChainEnd && (limit.expiresAtChainLength ?? 0) < state.chain.length);
}

function clearChainLimits(state: DuelState, shouldClear: (limit: ChainLimit) => boolean = () => true): void {
  const remaining: ChainLimit[] = [];
  for (const limit of state.chainLimits) {
    if (shouldClear(limit)) limit.release?.();
    else remaining.push(limit);
  }
  state.chainLimits = remaining;
}

export function negateDuelChainLink(state: DuelState, chainLinkId: string, player: PlayerId, cardName: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || link.negated) return false;
  link.negated = true;
  link.disableReason = duelReason.effect;
  link.disablePlayer = player;
  pushDuelLog(state, "negate", player, cardName, link.effectId);
  return true;
}

function result(session: DuelSession, ok: boolean, error?: string): ApplyDuelResponseResult {
  return {
    ok,
    ...(error === undefined ? {} : { error }),
    state: queryPublicState(session),
    legalActions: getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer),
  };
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || card.kind === "extra";
}

function isFaceUpPendulumExtraDeckCard(card: DuelCardInstance): boolean {
  return card.faceUp && ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}
