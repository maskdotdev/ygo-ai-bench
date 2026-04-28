import type { CardInstance } from "../engine/index.js";
import { DARK_MAGICIAN_CARD_IDS } from "./definitions.js";

export function isDarkMagician(card: CardInstance): boolean {
  return card.id === DARK_MAGICIAN_CARD_IDS.darkMagician;
}

export function isDarkMagicianMonster(card: CardInstance): boolean {
  return card.type === "monster" && card.tags.includes("dark-magician");
}

export function isDarkMagicianSpellTrap(card: CardInstance): boolean {
  return (card.type === "spell" || card.type === "trap") && card.tags.includes("dark-magician");
}

export function isDarkMagicianCard(card: CardInstance): boolean {
  return card.tags.includes("dark-magician");
}

export function isSpellcaster(card: CardInstance): boolean {
  return card.tags.includes("spellcaster");
}

export function isRitualMonster(card: CardInstance): boolean {
  return card.tags.includes("ritual");
}

export function isFusion(card: CardInstance): boolean {
  return card.tags.includes("fusion");
}

export function byId(id: string): (card: CardInstance) => boolean {
  return (card) => card.id === id;
}
