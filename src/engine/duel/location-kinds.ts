import type { DuelLocation } from "#duel/types.js";

export const duelLocations: readonly DuelLocation[] = ["deck", "hand", "monsterZone", "spellTrapZone", "fieldZone", "graveyard", "banished", "extraDeck", "overlay"];

const duelLocationSet = new Set<DuelLocation>(duelLocations);

export function isDuelLocation(value: unknown): value is DuelLocation {
  return duelLocationSet.has(value as DuelLocation);
}
