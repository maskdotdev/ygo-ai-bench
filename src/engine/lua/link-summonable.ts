import fengari from "fengari";
import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua } = fengari;

export function canLuaLinkSummonCard(session: DuelSession, card: DuelCardInstance, requiredUids: string[], materialGroupUids: string[], min = 1, max = Number.POSITIVE_INFINITY): boolean {
  if (card.location !== "extraDeck" || !isMonsterLike(card) || !hasZoneSpace(session.state, card.controller, "monsterZone")) return false;
  const required = new Set(requiredUids);
  const allowed = new Set(materialGroupUids);
  const materialPool = session.state.cards.filter(
    (candidate) =>
      candidate.controller === card.controller &&
      candidate.location === "monsterZone" &&
      (allowed.size === 0 || allowed.has(candidate.uid)) &&
      canBeLinkMaterial(session, candidate, card),
  );
  if ([...required].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return false;
  const targetRating = linkRating(card);
  if (targetRating <= 0) return false;
  const minCount = Math.max(1, min, required.size);
  const maxCount = Math.min(materialPool.length, max, targetRating);
  for (let count = minCount; count <= maxCount; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...required].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if (linkMaterialCodesMatch(materials, card.data.linkMaterials) && canLinkMaterialsMatchRating(materials, targetRating)) return true;
    }
  }
  return false;
}

export function readLinkMaterialArguments(L: unknown): { requiredUids: string[]; materialGroupUids: string[]; min?: number; max?: number } {
  const requiredUid = readCardUid(L, 2);
  const groupFromSecond = readGroupUids(L, 2);
  const groupFromThird = readGroupUids(L, 3);
  const min = readNumber(L, 4);
  const max = readNumber(L, 5);
  return {
    requiredUids: requiredUid ? [requiredUid] : [],
    materialGroupUids: groupFromThird.length > 0 ? groupFromThird : groupFromSecond,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

function canBeLinkMaterial(session: DuelSession, card: DuelCardInstance, target: DuelCardInstance): boolean {
  if (!isMonsterLike(card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(target, card) && !isMaterialUsePrevented(session.state, card.uid, "link", createMaterialCheckContext(session));
}

function targetAllowsMaterial(target: DuelCardInstance, card: DuelCardInstance): boolean {
  return !target.data.linkMaterials?.length || target.data.linkMaterials.some((code) => cardCodes(card).includes(code));
}

function linkMaterialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[] | undefined): boolean {
  return !requiredCodes?.length || materialCodesMatch(materials, requiredCodes);
}

function canLinkMaterialsMatchRating(materials: DuelCardInstance[], targetRating: number): boolean {
  if (materials.length === 0 || materials.length > targetRating) return false;
  return linkRatingChoicesMatch(materials.map(linkMaterialRatings), targetRating, 0, 0);
}

function linkRatingChoicesMatch(choices: number[][], targetRating: number, index: number, currentRating: number): boolean {
  if (index >= choices.length) return currentRating === targetRating;
  for (const rating of choices[index] ?? []) {
    if (currentRating + rating <= targetRating && linkRatingChoicesMatch(choices, targetRating, index + 1, currentRating + rating)) return true;
  }
  return false;
}

function linkMaterialRatings(card: DuelCardInstance): number[] {
  const rating = linkRating(card);
  return rating > 1 ? [1, rating] : [1];
}

function linkRating(card: DuelCardInstance): number {
  if (!card.data.linkMaterials?.length && (cardTypeFlags(card) & 0x4000000) === 0) return 0;
  return card.data.level ?? card.data.linkMaterials?.length ?? 0;
}

function materialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[]): boolean {
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && cardCodes(candidate).includes(code));
    if (!material) return false;
    used.add(material.uid);
  }
  return used.size === materials.length;
}

function cardCombinations(cards: DuelCardInstance[], count: number): DuelCardInstance[][] {
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

function cardCodes(card: DuelCardInstance): string[] {
  return [card.code, ...(card.data.alias ? [card.data.alias] : [])];
}

function cardTypeFlags(card: DuelCardInstance): number {
  return card.data.typeFlags ?? (card.kind === "spell" ? 0x2 : card.kind === "trap" ? 0x4 : 0x1);
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
}

function readNumber(L: unknown, index: number): number | undefined {
  return lua.lua_isnumber(L, index) ? lua.lua_tointeger(L, index) : undefined;
}

function createMaterialCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}
