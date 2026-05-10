import type { DuelCardInstance } from "#duel/types.js";

export interface MaterialCodeMatchOptions {
  canSubstitute?: (card: DuelCardInstance, requiredCode: string) => boolean;
  matchesCode?: (card: DuelCardInstance, requiredCode: string) => boolean;
  maxSubstitutes?: number;
  requiredUids?: readonly string[];
}

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

export function materialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[], options: MaterialCodeMatchOptions = {}): boolean {
  if (materials.length !== requiredCodes.length) return false;
  return selectMaterialUidsForCodes(materials, requiredCodes, options) !== undefined;
}

export function selectMaterialUidsForCodes(cards: DuelCardInstance[], requiredCodes: string[], options: MaterialCodeMatchOptions = {}): string[] | undefined {
  if (requiredCodes.length === 0) return [];
  if (cards.length < requiredCodes.length) return undefined;
  const maxSubstitutes = options.canSubstitute ? options.maxSubstitutes ?? Number.POSITIVE_INFINITY : 0;
  const requiredUids = new Set(options.requiredUids ?? []);
  if (requiredUids.size > requiredCodes.length) return undefined;
  const used = new Set<string>();
  return selectMaterialUids(cards, requiredCodes, options, maxSubstitutes, requiredUids, used, 0, 0);
}

function selectMaterialUids(
  cards: DuelCardInstance[],
  requiredCodes: string[],
  options: MaterialCodeMatchOptions,
  maxSubstitutes: number,
  requiredUids: Set<string>,
  used: Set<string>,
  codeIndex: number,
  substituteCount: number,
): string[] | undefined {
  if (codeIndex >= requiredCodes.length) {
    return [...requiredUids].every((uid) => used.has(uid)) ? [] : undefined;
  }
  const code = requiredCodes[codeIndex];
  if (!code) return undefined;
  const exactMatches = cards.map((card) => ({ card, substitute: false })).filter(({ card }) => !used.has(card.uid) && materialMatchesCode(card, code, options));
  const substituteMatches =
    substituteCount >= maxSubstitutes
      ? []
      : cards
          .map((card) => ({ card, substitute: true }))
          .filter(({ card }) => !used.has(card.uid) && !materialMatchesCode(card, code, options) && Boolean(options.canSubstitute?.(card, code)));
  for (const { card, substitute } of [...exactMatches, ...substituteMatches]) {
    used.add(card.uid);
    const tail = selectMaterialUids(cards, requiredCodes, options, maxSubstitutes, requiredUids, used, codeIndex + 1, substituteCount + (substitute ? 1 : 0));
    used.delete(card.uid);
    if (tail) return [card.uid, ...tail];
  }
  return undefined;
}

function materialMatchesCode(card: DuelCardInstance, code: string, options: MaterialCodeMatchOptions): boolean {
  return options.matchesCode?.(card, code) ?? cardMatchesCode(card, code);
}

export function cardMatchesCode(card: DuelCardInstance, code: string): boolean {
  return card.code === code || card.data.alias === code;
}

export function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || (card.kind === "extra" && card.data.kind !== "spell" && card.data.kind !== "trap");
}
