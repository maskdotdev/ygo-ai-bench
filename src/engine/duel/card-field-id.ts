import type { DuelCardInstance, DuelState } from "#duel/types.js";

const maxFieldId = 0x7fffffff;

export function cardFieldId(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  return card.fieldId ?? stableCardFieldId(card.uid);
}

export function nextDuelCardFieldId(state: DuelState): number {
  const used = new Set(state.cards.map(cardFieldId));
  const highest = state.cards.reduce((current, card) => Math.max(current, card.fieldId ?? 0), 0);
  for (let candidate = highest + 1; candidate <= maxFieldId; candidate += 1) {
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No card field ids are available");
}

function stableCardFieldId(uid: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < uid.length; index += 1) {
    value ^= uid.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value & maxFieldId;
}
