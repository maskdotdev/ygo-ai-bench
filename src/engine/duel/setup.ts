import { shuffle } from "#engine/rng.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { createDuelActivityCounts } from "#duel/activity.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import { nextDuelCardFieldId } from "#duel/card-field-id.js";
import { getCards, pushDuelLog, resequence } from "#duel/card-state.js";
import { drawDuelCardsFromDeck } from "#duel/turn-flow.js";
import type { CardPosition, DuelCardReader, DuelLocation, DuelOptions, DuelPlayerDeck, DuelSession, DuelState, PlayerId } from "#duel/types.js";

export interface CreateDuelOptions extends DuelOptions {
  cardReader?: DuelCardReader;
}

export function createDuel(options: CreateDuelOptions = {}): DuelSession {
  const seed = String(options.seed ?? Date.now());
  const state: DuelState = {
    id: `duel-${seed}-${Date.now().toString(36)}`,
    seed,
    actionWindowId: 0,
    actionWindowToken: createActionWindowToken(),
    status: "setup",
    turn: 0,
    turnPlayer: 0,
    phase: "draw",
    randomCounter: 0,
    lastDiceResults: [],
    lastCoinResults: [],
    players: {
      0: { id: 0, lifePoints: options.startingLifePoints ?? 8000, normalSummonAvailable: true, pendulumSummonAvailable: true, extraPendulumSummons: 0 },
      1: { id: 1, lifePoints: options.startingLifePoints ?? 8000, normalSummonAvailable: true, pendulumSummonAvailable: true, extraPendulumSummons: 0 },
    },
    cards: [],
    effects: [],
    chain: [],
    chainLimits: [],
    chainPasses: [],
    pendingTriggers: [],
    eventHistory: [],
    usedCountKeys: [],
    flagEffects: [],
    duelTypeFlags: options.duelTypeFlags ?? (0x2000 | 0x4000 | 0x8000 | 0x20000),
    globalFlags: 0,
    unofficialProcEnabled: false,
    shuffleCheckDisabled: false,
    skippedPhases: [],
    phaseActivity: false,
    activityCounts: createDuelActivityCounts(),
    activityHistory: [],
    battleDamage: { 0: 0, 1: 0 },
    attackCostPaid: 0,
    attacksDeclared: [],
    attackCanceledUids: [],
    attackedTargetUids: [],
    battlePairs: [],
    attackPasses: [],
    damagePasses: [],
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
    session.state.players[player].initialMainDeckSize = deck.main.length;
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
    drawDuelCardsFromDeck(session.state, player, session.state.options.startingHandSize, "Opening hand");
  }
  session.state.status = "awaiting";
  session.state.turn = 1;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.phaseActivity = false;
  session.state.waitingFor = 0;
  pushDuelLog(session.state, "startDuel", undefined, undefined, "Duel started");
}

function instantiateDeck(session: DuelSession, player: PlayerId, location: DuelLocation, codes: string[]): void {
  for (const [index, code] of codes.entries()) {
    const data = session.cardReader(String(code)) ?? fallbackCardReader(String(code));
    session.state.cards.push({
      uid: `p${player}-${location}-${code}-${index}`,
      fieldId: nextDuelCardFieldId(session.state),
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
