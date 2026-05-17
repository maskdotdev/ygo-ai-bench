import { cardTypeFlags } from "#duel/card-stats.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

export function isDuelMonsterLike(card: DuelCardInstance, state?: DuelState): boolean {
  if (state && (cardTypeFlags(card, state) & 0x1) !== 0) return true;
  return card.kind === "monster" || (card.data.typeFlags !== undefined && (card.data.typeFlags & 0x1) !== 0) || (card.kind === "extra" && card.data.kind !== "spell" && card.data.kind !== "trap");
}

export function isFaceUpPendulumExtraDeckCard(card: DuelCardInstance): boolean {
  return card.faceUp && ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}
