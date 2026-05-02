import type { DuelCardInstance } from "#duel/types.js";

export function cardCombinations(cards: DuelCardInstance[], count: number): DuelCardInstance[][] {
  if (count === 0) return [[]];
  if (cards.length < count) return [];
  const results: DuelCardInstance[][] = [];
  for (let index = 0; index <= cards.length - count; index += 1) {
    const head = cards[index];
    if (!head) continue;
    for (const tail of cardCombinations(cards.slice(index + 1), count - 1)) results.push([head, ...tail]);
  }
  return results;
}

export function materialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[]): boolean {
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && cardMatchesCode(candidate, code));
    if (!material) return false;
    used.add(material.uid);
  }
  return used.size === materials.length;
}

export function cardMatchesCode(card: DuelCardInstance, code: string): boolean {
  return card.code === code || card.data.alias === code;
}

export function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || (card.kind === "extra" && card.data.kind !== "spell" && card.data.kind !== "trap");
}
