import { pruneResetEffectsAfterMove } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterMove } from "#duel/flags.js";
import type { DuelCardInstance, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export function moveDuelCard(state: DuelState, uid: string, to: DuelLocation, controller?: PlayerId, reason = 0, reasonPlayer?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  card.previousLocation = card.location;
  card.previousController = card.controller;
  card.previousSequence = card.sequence;
  card.previousPosition = card.position;
  card.previousFaceUp = card.faceUp;
  card.reason = reason;
  card.reasonPlayer = reasonPlayer ?? controller ?? card.controller;
  card.location = to;
  if (to !== "spellTrapZone") delete card.equippedToUid;
  for (const other of state.cards) {
    if (other.equippedToUid === uid && to !== "monsterZone") delete other.equippedToUid;
  }
  if (controller !== undefined) card.controller = controller;
  card.sequence = nextSequence(state, card.controller, to);
  if (to === "hand" || to === "overlay") card.faceUp = false;
  if (to === "extraDeck") {
    card.faceUp = isPendulumCard(card);
    card.position = "faceDown";
  }
  if (to === "graveyard" || to === "banished" || to === "monsterZone" || to === "spellTrapZone") card.faceUp = true;
  resequence(state, card.controller, to);
  pruneResetEffectsAfterMove(state, card);
  pruneDuelFlagEffectsAfterMove(state, card);
  return card;
}

export function canMoveDuelCardToLocation(state: DuelState, uid: string, to: DuelLocation): boolean {
  const card = findCard(state, uid);
  if (!card || card.location === to) return false;
  if (to === "extraDeck") return card.kind === "extra" || isPendulumCard(card);
  return true;
}

export function getCards(state: DuelState, player: PlayerId, location: DuelLocation): DuelCardInstance[] {
  return state.cards.filter((card) => card.controller === player && card.location === location).sort((a, b) => a.sequence - b.sequence);
}

export function findCard(state: DuelState, uid: string): DuelCardInstance | undefined {
  return state.cards.find((card) => card.uid === uid);
}

export function requireControlledCard(state: DuelState, player: PlayerId, uid: string, location?: DuelLocation): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  if (card.controller !== player) throw new Error(`${card.name} is not controlled by player ${player}`);
  if (location && card.location !== location) throw new Error(`${card.name} is not in ${location}`);
  return card;
}

export function hasZoneSpace(state: DuelState, player: PlayerId, location: DuelLocation): boolean {
  if (location !== "monsterZone" && location !== "spellTrapZone") return true;
  return getCards(state, player, location).length < 5;
}

export function requireZoneSpace(state: DuelState, player: PlayerId, location: DuelLocation): void {
  if (!hasZoneSpace(state, player, location)) throw new Error(`${location} is full for player ${player}`);
}

export function requireMoveAllowed(state: DuelState, uid: string, to: DuelLocation): void {
  if (!canMoveDuelCardToLocation(state, uid, to)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

export function resequence(state: DuelState, player: PlayerId, location: DuelLocation): void {
  for (const [sequence, card] of getCards(state, player, location).entries()) card.sequence = sequence;
}

export function pushDuelLog(state: DuelState, action: string, player: PlayerId | undefined, card: string | undefined, detail: string): void {
  state.log.push({ step: state.log.length + 1, action, detail, ...(player === undefined ? {} : { player }), ...(card === undefined ? {} : { card }) });
}

function nextSequence(state: DuelState, player: PlayerId, location: DuelLocation): number {
  return getCards(state, player, location).length;
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}
