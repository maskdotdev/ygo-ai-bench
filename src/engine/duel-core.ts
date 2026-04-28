import { shuffle } from "./rng.js";
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
    pendingTriggers: [],
    usedCountKeys: [],
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
    if (state.players[player].normalSummonAvailable) {
      for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
        actions.push({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name}` });
      }
    }
    for (const card of hand.filter((candidate) => candidate.kind === "spell" || candidate.kind === "trap")) {
      actions.push({ type: "setSpellTrap", player, uid: card.uid, label: `Set ${card.name}` });
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
    if (response.type === "normalSummon") normalSummon(session.state, response.player, response.uid);
    else if (response.type === "setSpellTrap") setSpellTrap(session.state, response.player, response.uid);
    else if (response.type === "activateEffect") activateEffect(session, response.player, response.uid, response.effectId);
    else if (response.type === "activateTrigger") activatePendingTrigger(session, response.player, response.triggerId);
    else if (response.type === "declineTrigger") declinePendingTrigger(session, response.player, response.triggerId);
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
    chain: state.chain.map((link) => ({ ...link })),
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
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
      chain: session.state.chain.map((link) => ({ ...link })),
      pendingTriggers: session.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...session.state.usedCountKeys],
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
      chain: snapshot.state.chain.map((link) => ({ ...link })),
      pendingTriggers: snapshot.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...snapshot.state.usedCountKeys],
      log: snapshot.state.log.map((entry) => ({ ...entry })),
    },
  };
}

export function moveDuelCard(state: DuelState, uid: string, to: DuelLocation, controller?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  card.location = to;
  if (controller !== undefined) card.controller = controller;
  card.sequence = nextSequence(state, card.controller, to);
  if (to === "hand") card.faceUp = false;
  if (to === "graveyard" || to === "banished" || to === "monsterZone" || to === "spellTrapZone") card.faceUp = true;
  resequence(state, card.controller, to);
  return card;
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

function normalSummon(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  moveDuelCard(state, uid, "monsterZone", player);
  card.position = "faceUpAttack";
  state.players[player].normalSummonAvailable = false;
  pushDuelLog(state, "normalSummon", player, card.name, "Normal Summoned from hand");
  collectTriggerEffects(state, "normalSummoned", card);
}

function setSpellTrap(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  moveDuelCard(state, uid, "spellTrapZone", player);
  card.position = "faceDown";
  card.faceUp = false;
  pushDuelLog(state, "set", player, card.name, "Set from hand");
}

function activateEffect(session: DuelSession, player: PlayerId, uid: string, effectId: string): void {
  const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid);
  if (!effect) throw new Error(`Effect ${effectId} is not registered`);
  const source = requireControlledCard(session.state, player, uid);
  const ctx = createEffectContext(session.state, source, player);
  if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effectId} could not be paid`);
  if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effectId} are not legal`);
  session.state.chain.push({ id: `chain-${session.state.log.length + 1}`, player, sourceUid: uid, effectId });
  pushDuelLog(session.state, "activate", player, source.name, effect.id);
  session.state.status = "resolving";
  effect.operation(ctx);
  if (effect.oncePerTurn) session.state.usedCountKeys.push(effectCountKey(session.state, effect));
  session.state.chain.pop();
  session.state.status = "awaiting";
}

function activatePendingTrigger(session: DuelSession, player: PlayerId, triggerId: string): void {
  const trigger = takePendingTrigger(session.state, player, triggerId);
  const effect = session.state.effects.find((candidate) => candidate.sourceUid === trigger.sourceUid && candidate.id === trigger.effectId);
  if (!effect) throw new Error(`Effect ${trigger.effectId} is not registered`);
  const source = findCard(session.state, trigger.sourceUid);
  const eventCard = findCard(session.state, trigger.eventCardUid);
  if (!source || !eventCard) throw new Error(`Trigger ${triggerId} lost its source or event card`);
  resolveEffect(session.state, effect, source, trigger.player, trigger.eventName, eventCard, "trigger");
  session.state.waitingFor = session.state.pendingTriggers[0]?.player ?? session.state.turnPlayer;
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
  pushDuelLog(state, "phase", player, undefined, `Moved to ${phase}`);
}

function endTurn(state: DuelState, player: PlayerId): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can end the turn");
  state.turn += 1;
  state.turnPlayer = otherPlayer(player);
  state.phase = "draw";
  state.waitingFor = state.turnPlayer;
  state.players[state.turnPlayer].normalSummonAvailable = true;
  draw(state, state.turnPlayer, state.options.drawPerTurn, "Turn draw");
  state.phase = "main1";
  pushDuelLog(state, "turn", state.turnPlayer, undefined, `Turn ${state.turn} started`);
}

function draw(state: DuelState, player: PlayerId, count: number, detail: string): void {
  for (let index = 0; index < count; index += 1) {
    const card = getCards(state, player, "deck").sort((a, b) => a.sequence - b.sequence)[0];
    if (!card) return;
    moveDuelCard(state, card.uid, "hand", player);
    pushDuelLog(state, "draw", player, card.name, detail);
  }
}

function createEffectContext(state: DuelState, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance): DuelEffectContext {
  return {
    duel: state,
    source,
    player,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCard }),
    log(detail) {
      pushDuelLog(state, "effect", player, source.name, detail);
    },
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
    },
  };
}

function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard: DuelCardInstance): void {
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

function createPendingTrigger(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard: DuelCardInstance): PendingTrigger {
  return {
    id: `trigger-${state.log.length + 1}-${state.pendingTriggers.length + 1}`,
    player: effect.controller,
    sourceUid: source.uid,
    effectId: effect.id,
    eventName,
    eventCardUid: eventCard.uid,
  };
}

function resolveEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, eventName: DuelEventName | undefined, eventCard: DuelCardInstance | undefined, logAction: string): void {
  const ctx = createEffectContext(state, source, player, eventName, eventCard);
  if (effect.cost && !effect.cost(ctx)) throw new Error(`Cost for ${effect.id} could not be paid`);
  if (effect.target && !effect.target(ctx)) throw new Error(`Targets for ${effect.id} are not legal`);
  state.chain.push({ id: `chain-${state.log.length + 1}`, player, sourceUid: source.uid, effectId: effect.id });
  pushDuelLog(state, logAction, player, source.name, effect.id);
  state.status = "resolving";
  effect.operation(ctx);
  if (effect.oncePerTurn) state.usedCountKeys.push(effectCountKey(state, effect));
  state.chain.pop();
  state.status = "awaiting";
}

function getCards(state: DuelState, player: PlayerId, location: DuelLocation): DuelCardInstance[] {
  return state.cards.filter((card) => card.controller === player && card.location === location).sort((a, b) => a.sequence - b.sequence);
}

function findCard(state: DuelState, uid: string): DuelCardInstance | undefined {
  return state.cards.find((card) => card.uid === uid);
}

function requireControlledCard(state: DuelState, player: PlayerId, uid: string, location?: DuelLocation): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  if (card.controller !== player) throw new Error(`${card.name} is not controlled by player ${player}`);
  if (location && card.location !== location) throw new Error(`${card.name} is not in ${location}`);
  return card;
}

function nextSequence(state: DuelState, player: PlayerId, location: DuelLocation): number {
  return getCards(state, player, location).length;
}

function resequence(state: DuelState, player: PlayerId, location: DuelLocation): void {
  for (const [sequence, card] of getCards(state, player, location).entries()) card.sequence = sequence;
}

function pushDuelLog(state: DuelState, action: string, player: PlayerId | undefined, card: string | undefined, detail: string): void {
  state.log.push({ step: state.log.length + 1, action, detail, ...(player === undefined ? {} : { player }), ...(card === undefined ? {} : { card }) });
}

function effectCountKey(state: DuelState, effect: DuelEffectDefinition): string {
  return `${state.turn}:${effect.controller}:${effect.sourceUid}:${effect.id}`;
}

function sameAction(a: DuelAction, b: DuelResponse): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;
  if ("uid" in a && "uid" in b && a.uid !== b.uid) return false;
  if (a.type === "activateEffect" && b.type === "activateEffect" && a.effectId !== b.effectId) return false;
  if (a.type === "activateTrigger" && b.type === "activateTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "declineTrigger" && b.type === "declineTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "changePhase" && b.type === "changePhase" && a.phase !== b.phase) return false;
  return true;
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
