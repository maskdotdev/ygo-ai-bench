import type { DuelCardInstance } from "#duel/types.js";

export const statusProcComplete = 0x8;

export function markProcedureComplete(card: DuelCardInstance): void {
  card.customStatusMask = (card.customStatusMask ?? 0) | statusProcComplete;
}

export function hasProcedureCompleteStatus(card: DuelCardInstance): boolean {
  return ((card.customStatusMask ?? 0) & statusProcComplete) !== 0;
}

export function hasReviveLimitProcedureComplete(card: DuelCardInstance): boolean {
  return Boolean(hasProcedureCompleteStatus(card) && card.summonType && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip");
}
