import type { DuelLocation } from "#duel/types.js";

export function locationMaskFromLocation(location: DuelLocation | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}

export function locationMaskFromLocations(locations: DuelLocation[]): number {
  let mask = 0;
  for (const location of locations) mask |= locationMaskFromLocation(location);
  return mask;
}
