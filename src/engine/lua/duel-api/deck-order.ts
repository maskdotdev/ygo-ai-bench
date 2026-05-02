import { getCards } from "#duel/card-state.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

export function moveDeckCardToTop(state: DuelState, card: DuelCardInstance): void {
  const cards = getCards(state, card.controller, "deck").filter((candidate) => candidate.uid !== card.uid);
  cards.unshift(card);
  resequenceCards(cards);
}

export function moveDeckCardToBottom(state: DuelState, card: DuelCardInstance): void {
  const cards = getCards(state, card.controller, "deck").filter((candidate) => candidate.uid !== card.uid);
  cards.push(card);
  resequenceCards(cards);
}

function resequenceCards(cards: DuelCardInstance[]): void {
  for (const [sequence, card] of cards.entries()) card.sequence = sequence;
}
