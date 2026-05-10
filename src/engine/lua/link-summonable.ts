import fengari from "fengari";
import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentLink, currentRace } from "#duel/card-stats.js";
import { isSummonTypeMaskMatch, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import { isSetcodeMatch } from "#lua/card-code-utils.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua } = fengari;

export function canLuaLinkSummonCard(session: DuelSession, card: DuelCardInstance, requiredUids: string[], materialGroupUids: string[], min?: number, max?: number): boolean {
  return findLuaLinkMaterialUidSet(session, card, requiredUids, materialGroupUids, min, max) !== undefined;
}

export function findLuaLinkMaterialUidSet(session: DuelSession, card: DuelCardInstance, requiredUids: string[], materialGroupUids: string[], min?: number, max?: number): string[] | undefined {
  if (card.location !== "extraDeck" || !isMonsterLike(session, card)) return undefined;
  const required = new Set(requiredUids);
  const allowed = new Set(materialGroupUids);
  const materialPool = session.state.cards.filter(
    (candidate) =>
      candidate.controller === card.controller &&
      candidate.location === "monsterZone" &&
      (allowed.size === 0 || allowed.has(candidate.uid)) &&
      canBeLinkMaterial(session, candidate, card),
  );
  if ([...required].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return undefined;
  const targetRating = linkRating(session, card);
  if (targetRating <= 0) return undefined;
  const minCount = Math.max(1, min ?? card.data.linkMaterialMin ?? 1, required.size);
  const maxCount = Math.min(materialPool.length, max ?? card.data.linkMaterialMax ?? Number.POSITIVE_INFINITY, targetRating);
  for (let count = minCount; count <= maxCount; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...required].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if (linkMaterialCodesMatch(materials, card.data.linkMaterials) && canLinkMaterialsMatchRating(session, materials, targetRating) && hasSummonZoneAfterMaterials(session, card.controller, materials)) return materials.map((material) => material.uid);
    }
  }
  return undefined;
}

function hasSummonZoneAfterMaterials(session: DuelSession, player: PlayerId, materials: DuelCardInstance[]): boolean {
  return hasZoneSpace(session.state, player, "monsterZone") || materials.some((material) => material.controller === player && material.location === "monsterZone");
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
  if (!isMonsterLike(session, card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(session, target, card) && !isMaterialUsePrevented(session.state, card.uid, "link", createMaterialCheckContext(session));
}

function targetAllowsMaterial(session: DuelSession, target: DuelCardInstance, card: DuelCardInstance): boolean {
  if (!linkMaterialTypeMatches(session, target, card)) return false;
  if (!linkMaterialRaceMatches(session, target, card)) return false;
  if (!linkMaterialAttributeMatches(session, target, card)) return false;
  if (!linkMaterialSetcodeMatches(target, card)) return false;
  if (!linkMaterialSummonTypeMatches(target, card)) return false;
  if (!linkMaterialLevelMatches(session, target, card)) return false;
  if (!linkMaterialMinLevelMatches(session, target, card)) return false;
  return !target.data.linkMaterials?.length || target.data.linkMaterials.some((code) => cardCodes(card).includes(code));
}

function linkMaterialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[] | undefined): boolean {
  return !requiredCodes?.length || materialCodesMatch(materials, requiredCodes);
}

function canLinkMaterialsMatchRating(session: DuelSession, materials: DuelCardInstance[], targetRating: number): boolean {
  if (materials.length === 0 || materials.length > targetRating) return false;
  return linkRatingChoicesMatch(materials.map((material) => linkMaterialRatings(session, material)), targetRating, 0, 0);
}

function linkRatingChoicesMatch(choices: number[][], targetRating: number, index: number, currentRating: number): boolean {
  if (index >= choices.length) return currentRating === targetRating;
  for (const rating of choices[index] ?? []) {
    if (currentRating + rating <= targetRating && linkRatingChoicesMatch(choices, targetRating, index + 1, currentRating + rating)) return true;
  }
  return false;
}

function linkMaterialRatings(session: DuelSession, card: DuelCardInstance): number[] {
  const rating = linkRating(session, card);
  return rating > 1 ? [1, rating] : [1];
}

function linkRating(session: DuelSession, card: DuelCardInstance): number {
  if (!card.data.linkMaterials?.length && (cardTypeFlags(card, session.state) & 0x4000000) === 0) return 0;
  return card.data.level === undefined ? card.data.linkMaterials?.length ?? 0 : currentLink(card, session.state);
}

function linkMaterialTypeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialType === undefined || (cardTypeFlags(material, session.state) & target.data.linkMaterialType) !== 0;
}

function linkMaterialRaceMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialRace === undefined || (currentRace(material, session.state) & target.data.linkMaterialRace) !== 0;
}

function linkMaterialAttributeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialAttribute === undefined || (currentAttribute(material, session.state) & target.data.linkMaterialAttribute) !== 0;
}

function linkMaterialSetcodeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialSetcode === undefined || (material.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.linkMaterialSetcode!, setcode));
}

function linkMaterialSummonTypeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialSummonType === undefined || isSummonTypeMaskMatch(summonTypeMaskFromCard(material), target.data.linkMaterialSummonType);
}

function linkMaterialLevelMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialLevel === undefined || currentLevel(material, session.state) === target.data.linkMaterialLevel;
}

function linkMaterialMinLevelMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialMinLevel === undefined || currentLevel(material, session.state) >= target.data.linkMaterialMinLevel;
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

function isMonsterLike(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1) !== 0;
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
