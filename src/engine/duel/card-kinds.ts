import type { CardPosition, DuelCardKind, DuelEffectDefinition, DuelSummonType } from "#duel/types.js";

export const duelCardKinds: readonly DuelCardKind[] = ["monster", "spell", "trap", "extra"];
export const cardPositions: readonly CardPosition[] = ["faceDownDefense", "faceUpAttack", "faceUpDefense", "faceDown"];
export const duelSummonTypes: readonly DuelSummonType[] = ["normal", "tribute", "flip", "special", "fusion", "synchro", "xyz", "link", "ritual", "pendulum"];
export const duelEffectEvents: readonly DuelEffectDefinition["event"][] = ["ignition", "trigger", "quick", "continuous", "summonProcedure"];

const duelCardKindSet = new Set<DuelCardKind>(duelCardKinds);
const cardPositionSet = new Set<CardPosition>(cardPositions);
const duelSummonTypeSet = new Set<DuelSummonType>(duelSummonTypes);
const duelEffectEventSet = new Set<DuelEffectDefinition["event"]>(duelEffectEvents);

export function isDuelCardKind(value: unknown): value is DuelCardKind {
  return duelCardKindSet.has(value as DuelCardKind);
}

export function isCardPosition(value: unknown): value is CardPosition {
  return cardPositionSet.has(value as CardPosition);
}

export function isDuelSummonType(value: unknown): value is DuelSummonType {
  return duelSummonTypeSet.has(value as DuelSummonType);
}

export function isDuelEffectEvent(value: unknown): value is DuelEffectDefinition["event"] {
  return duelEffectEventSet.has(value as DuelEffectDefinition["event"]);
}
