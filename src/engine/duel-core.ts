import { shuffle } from "./rng.js";
import {
  findCard,
  getCards,
  hasZoneSpace,
  moveDuelCard,
  pushDuelLog,
  requireControlledCard,
  requireMoveAllowed,
  requireZoneSpace,
  resequence,
} from "./duel-card-state.js";
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
  xyzSummonActions,
  xyzSummonDuelCard as xyzSummonDuelCardWithEvents,
} from "./duel-summon.js";
import {
  attackActions,
  canChangeDuelCardPosition as canChangeDuelCardPositionRule,
  canDuelCardAttack as canDuelCardAttackRule,
  changeDuelCardPosition as changeDuelCardPositionRule,
  declareDuelAttack as declareDuelAttackRule,
  getDuelAttackTargets as getDuelAttackTargetsRule,
  positionChangeActions,
} from "./duel-battle.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  DuelAction,
  DuelCardData,
  DuelCardInstance,
  DuelCardReader,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelEventName,
  DuelLocation,
  DuelOptions,
  DuelPhase,
  DuelPlayerDeck,
  DuelResponse,
  DuelSession,
  DuelState,
  PendingTrigger,
  PlayerId,
  PublicDuelCard,
  PublicDuelState,
  SerializedDuel,
} from "./duel-types.js";

export { canMoveDuelCardToLocation, moveDuelCard } from "./duel-card-state.js";

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
    chainPasses: [],
    pendingTriggers: [],
    usedCountKeys: [],
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
    actions.push(...tributeSummonActions(state, player, hand));
    actions.push(...fusionSummonActions(state, player));
    actions.push(...synchroSummonActions(state, player));
    actions.push(...xyzSummonActions(state, player));
    actions.push(...linkSummonActions(state, player));
    actions.push(...ritualSummonActions(state, player, hand));
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
      if (effect.oncePerTurn && state.usedCountKeys.includes(effectCountKey(state, effect))) continue;
      const ctx = createEffectContext(state, source, player);
      if (effect.canActivate && !effect.canActivate(ctx)) continue;
      actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
    }
    actions.push(...positionChangeActions(state, player));
    actions.push(...flipSummonActions(state, player));
  }
  if (state.phase === "battle") {
    actions.push(...attackActions(state, player));
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
    else if (response.type === "setMonster") setMonster(session.state, response.player, response.uid);
    else if (response.type === "setSpellTrap") setSpellTrap(session.state, response.player, response.uid);
    else if (response.type === "activateEffect") activateEffect(session, response.player, response.uid, response.effectId);
    else if (response.type === "passChain") passChain(session.state, response.player);
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

export function queryPublicState(session: DuelSession): PublicDuelState {
  const state = session.state;
  return {
    id: state.id,
    status: state.status,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
    players: {
      0: { ...state.players[0] },
      1: { ...state.players[1] },
    },
    cards: state.cards.map(toPublicCard).sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence),
    chain: state.chain.map(copyChainLink),
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
    attacksDeclared: [...state.attacksDeclared],
    positionsChanged: [...state.positionsChanged],
    log: state.log.map((entry) => ({ ...entry })),
  };
}

export function serializeDuel(session: DuelSession): SerializedDuel {
  return {
    version: 1,
    state: {
      ...session.state,
      players: {
        0: { ...session.state.players[0] },
        1: { ...session.state.players[1] },
      },
      cards: session.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: [],
      chain: session.state.chain.map(copyChainLink),
      chainPasses: [...session.state.chainPasses],
      pendingTriggers: session.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...session.state.usedCountKeys],
      attacksDeclared: [...session.state.attacksDeclared],
      positionsChanged: [...session.state.positionsChanged],
      ...(session.state.currentAttack === undefined ? {} : { currentAttack: { ...session.state.currentAttack } }),
      log: session.state.log.map((entry) => ({ ...entry })),
    },
  };
}

export function restoreDuel(snapshot: SerializedDuel, cardReader: DuelCardReader = fallbackCardReader): DuelSession {
  if (snapshot.version !== 1) throw new Error(`Unsupported duel snapshot version ${snapshot.version}`);
  return {
    cardReader,
    state: {
      ...snapshot.state,
      players: {
        0: { ...snapshot.state.players[0] },
        1: { ...snapshot.state.players[1] },
      },
      cards: snapshot.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: [],
      chain: snapshot.state.chain.map(copyChainLink),
      chainPasses: [...snapshot.state.chainPasses],
      pendingTriggers: snapshot.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...snapshot.state.usedCountKeys],
      attacksDeclared: [...snapshot.state.attacksDeclared],
      positionsChanged: [...snapshot.state.positionsChanged],
      ...(snapshot.state.currentAttack === undefined ? {} : { currentAttack: { ...snapshot.state.currentAttack } }),
      log: snapshot.state.log.map((entry) => ({ ...entry })),
    },
  };
}

export function specialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const summonController = controller ?? card.controller;
  requireZoneSpace(state, summonController, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", summonController);
  card.position = "faceUpAttack";
  card.faceUp = true;
  pushDuelLog(state, "specialSummon", card.controller, card.name, "Special Summoned");
  collectTriggerEffects(state, "specialSummoned", card);
  return card;
}

export function sendDuelCardToGraveyard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  requireMoveAllowed(state, uid, "graveyard");
  const card = moveDuelCard(state, uid, "graveyard", controller);
  pushDuelLog(state, "sendToGraveyard", card.controller, card.name, "Sent to the Graveyard");
  collectTriggerEffects(state, "sentToGraveyard", card);
  return card;
}

export function destroyDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  requireMoveAllowed(state, uid, "graveyard");
  const card = moveDuelCard(state, uid, "graveyard", controller);
  pushDuelLog(state, "destroy", card.controller, card.name, "Destroyed");
  collectTriggerEffects(state, "sentToGraveyard", card);
  return card;
}

export function banishDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  requireMoveAllowed(state, uid, "banished");
  const card = moveDuelCard(state, uid, "banished", controller);
  pushDuelLog(state, "banish", card.controller, card.name, "Banished");
  collectTriggerEffects(state, "banished", card);
  return card;
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
  tributeSummonDuelCardWithEvents(state, player, uid, tributeUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string): DuelCardInstance {
  return flipSummonDuelCardWithEvents(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function fusionSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return fusionSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function synchroSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return synchroSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return xyzSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function linkSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return linkSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function ritualSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return ritualSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function drawDuelCards(state: DuelState, player: PlayerId, count: number, detail = "Effect draw"): number {
  return draw(state, player, Math.max(0, count), detail);
}

export function canDuelCardAttack(state: DuelState, uid: string): boolean {
  return canDuelCardAttackRule(state, uid);
}

export function getDuelAttackTargets(state: DuelState, attackerUid: string): DuelCardInstance[] {
  return getDuelAttackTargetsRule(state, attackerUid);
}

export function declareDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid?: string): void {
  declareDuelAttackRule(state, player, attackerUid, targetUid, {
    collectEvent: (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount) => damageDuelPlayer(state, damagedPlayer, amount),
    destroyCard: (uid, controller) => destroyDuelCard(state, uid, controller),
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

function fallbackCardReader(code: string): DuelCardData {
  return {
    code,
    name: `Card ${code}`,
    kind: "monster",
  };
}

function setSpellTrap(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  requireZoneSpace(state, player, "spellTrapZone");
  moveDuelCard(state, uid, "spellTrapZone", player);
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
  pushChainLink(session.state, player, uid, effectId, undefined, undefined, targetUids);
  pushDuelLog(session.state, "activate", player, source.name, effect.id);
  markEffectUsed(session.state, effect);
  const responsePlayer = otherPlayer(player);
  if (hasChainResponses(session.state, responsePlayer)) {
    session.state.waitingFor = responsePlayer;
    return;
  }
  resolveChain(session.state);
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
  pushChainLink(session.state, trigger.player, source.uid, effect.id, trigger.eventName, eventCard, targetUids);
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
    moveDuelCard(state, card.uid, "hand", player);
    pushDuelLog(state, "draw", player, card.name, detail);
    drawn += 1;
  }
  return drawn;
}

function createEffectContext(state: DuelState, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance, targetUids: string[] = []): DuelEffectContext {
  return {
    duel: state,
    source,
    player,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCard }),
    targetUids,
    log(detail) {
      pushDuelLog(state, "effect", player, source.name, detail);
    },
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
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
  };
}

function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  for (const effect of state.effects) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (effect.oncePerTurn && state.usedCountKeys.includes(effectCountKey(state, effect))) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createEffectContext(state, source, effect.controller, eventName, eventCard);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
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

function quickEffectActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "quick") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (effect.oncePerTurn && state.usedCountKeys.includes(effectCountKey(state, effect))) continue;
    const ctx = createEffectContext(state, source, player);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
  }
  return actions;
}

function hasChainResponses(state: DuelState, player: PlayerId): boolean {
  return quickEffectActions(state, player).length > 0;
}

function pushChainLink(state: DuelState, player: PlayerId, sourceUid: string, effectId: string, eventName?: DuelEventName, eventCard?: DuelCardInstance, targetUids: string[] = []): void {
  state.chain.push({
    id: `chain-${state.log.length + 1}`,
    player,
    sourceUid,
    effectId,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
    ...(targetUids.length === 0 ? {} : { targetUids: [...targetUids] }),
  });
  state.chainPasses = [];
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
    const ctx = createEffectContext(state, source, link.player, link.eventName, eventCard, [...(link.targetUids ?? [])]);
    effect.operation(ctx);
  }
  state.chainPasses = [];
  state.status = "awaiting";
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

export function negateDuelChainLink(state: DuelState, chainLinkId: string, player: PlayerId, cardName: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || link.negated) return false;
  link.negated = true;
  pushDuelLog(state, "negate", player, cardName, link.effectId);
  return true;
}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return { ...link, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
}

function effectCountKey(state: DuelState, effect: DuelEffectDefinition): string {
  return `${state.turn}:${effect.controller}:${effect.sourceUid}:${effect.id}`;
}

function markEffectUsed(state: DuelState, effect: DuelEffectDefinition): void {
  if (!effect.oncePerTurn) return;
  const key = effectCountKey(state, effect);
  if (!state.usedCountKeys.includes(key)) state.usedCountKeys.push(key);
}

function sameAction(a: DuelAction, b: DuelResponse): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;
  if ("uid" in a && "uid" in b && a.uid !== b.uid) return false;
  if (a.type === "activateEffect" && b.type === "activateEffect" && a.effectId !== b.effectId) return false;
  if (a.type === "activateTrigger" && b.type === "activateTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "declineTrigger" && b.type === "declineTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "tributeSummon" && b.type === "tributeSummon" && !sameStringSet(a.tributeUids, b.tributeUids)) return false;
  if (a.type === "fusionSummon" && b.type === "fusionSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "synchroSummon" && b.type === "synchroSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "xyzSummon" && b.type === "xyzSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "linkSummon" && b.type === "linkSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "ritualSummon" && b.type === "ritualSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "changePosition" && b.type === "changePosition" && a.position !== b.position) return false;
  if (a.type === "declareAttack" && b.type === "declareAttack" && a.attackerUid !== b.attackerUid) return false;
  if (a.type === "declareAttack" && b.type === "declareAttack" && a.targetUid !== b.targetUid) return false;
  if (a.type === "changePhase" && b.type === "changePhase" && a.phase !== b.phase) return false;
  return true;
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function toPublicCard(card: DuelCardInstance): PublicDuelCard {
  return {
    uid: card.uid,
    code: card.code,
    name: card.name,
    kind: card.kind,
    owner: card.owner,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
    overlayCount: card.overlayUids.length,
  };
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
