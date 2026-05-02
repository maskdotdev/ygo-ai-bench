import { getCards } from "#duel/card-state.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function activeFieldSpell(state: DuelState, player: PlayerId, exceptUid?: string): DuelCardInstance | undefined {
  return getCards(state, player, "spellTrapZone").find((card) => card.uid !== exceptUid && isFieldSpell(card));
}

export function isFieldSpell(card: DuelCardInstance): boolean {
  return card.kind === "spell" && ((card.data.typeFlags ?? 0) & 0x80000) !== 0;
}

export function isDuelType(state: DuelState, mask: number): boolean {
  return (BigInt(Math.trunc(state.duelTypeFlags)) & BigInt(mask)) === BigInt(mask);
}
