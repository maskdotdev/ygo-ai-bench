import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentRace, currentRank } from "#duel/card-stats.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

export function canLuaXyzSummonCard(session: DuelSession, card: DuelCardInstance, suppliedUids: string[]): boolean {
  return findLuaXyzMaterialUidSet(session, card, suppliedUids) !== undefined;
}

export function findLuaXyzMaterialUidSet(session: DuelSession, card: DuelCardInstance, suppliedUids: string[], player: PlayerId = card.controller): string[] | undefined {
  if (card.location !== "extraDeck" || !isMonsterLike(session, card)) return undefined;
  const supplied = new Set(suppliedUids);
  const materialPool = session.state.cards.filter((candidate) => candidate.controller === player && candidate.location === "monsterZone" && canBeXyzMaterial(session, candidate, card));
  if ([...supplied].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return undefined;
  if (card.data.xyzMaterials?.length) {
    const count = xyzMaterialCount(card);
    if (supplied.size > count) return undefined;
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...supplied].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if (materialCodesMatch(session, materials, card.data.xyzMaterials) && hasSummonZoneAfterMaterials(session, player, materials)) return materials.map((material) => material.uid);
    }
    return undefined;
  }
  const maxCount = Math.min(materialPool.length, xyzMaterialMax(card));
  if (supplied.size > maxCount) return undefined;
  for (let count = Math.max(xyzMaterialCount(card), supplied.size); count <= maxCount; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...supplied].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if (canGenericXyzMaterialsMatch(session, card, materials) && hasSummonZoneAfterMaterials(session, player, materials)) return materials.map((material) => material.uid);
    }
  }
  return undefined;
}

function hasSummonZoneAfterMaterials(session: DuelSession, player: PlayerId, materials: DuelCardInstance[]): boolean {
  return hasZoneSpace(session.state, player, "monsterZone") || materials.some((material) => material.controller === player && material.location === "monsterZone");
}

function canBeXyzMaterial(session: DuelSession, card: DuelCardInstance, target: DuelCardInstance): boolean {
  if (!isMonsterLike(session, card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(session, target, card) && !isMaterialUsePrevented(session.state, card.uid, "xyz", createMaterialCheckContext(session));
}

function targetAllowsMaterial(session: DuelSession, target: DuelCardInstance, card: DuelCardInstance): boolean {
  if (target.data.xyzMaterials?.length) return target.data.xyzMaterials.some((code) => currentCardMatchesCode(card, session.state, code));
  if (!xyzMaterialRaceMatches(session, target, card)) return false;
  if (!xyzMaterialAttributeMatches(session, target, card)) return false;
  if (!xyzMaterialTypeMatches(session, target, card)) return false;
  if (!xyzMaterialSetcodeMatches(session, target, card)) return false;
  if (!xyzMaterialRankMatches(session, target, card)) return false;
  const targetRank = cardRank(session, target);
  return targetRank > 0 && currentLevel(card, session.state) === targetRank;
}

function canGenericXyzMaterialsMatch(session: DuelSession, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetRank = cardRank(session, card);
  return targetRank > 0 && materials.length >= xyzMaterialCount(card) && materials.length <= xyzMaterialMax(card) && materials.every((material) => currentLevel(material, session.state) === targetRank && xyzMaterialRaceMatches(session, card, material) && xyzMaterialAttributeMatches(session, card, material) && xyzMaterialTypeMatches(session, card, material) && xyzMaterialSetcodeMatches(session, card, material) && xyzMaterialRankMatches(session, card, material));
}

function materialCodesMatch(session: DuelSession, materials: DuelCardInstance[], requiredCodes: string[]): boolean {
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && currentCardMatchesCode(candidate, session.state, code));
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

function cardRank(session: DuelSession, card: DuelCardInstance): number {
  return (cardTypeFlags(card, session.state) & 0x800000) !== 0 ? currentRank(card, session.state) : 0;
}

function xyzMaterialCount(card: DuelCardInstance): number {
  return card.data.xyzMaterials?.length || card.data.xyzMaterialCount || 2;
}

function xyzMaterialMax(card: DuelCardInstance): number {
  return card.data.xyzMaterials?.length || card.data.xyzMaterialMax || xyzMaterialCount(card);
}

function xyzMaterialRaceMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialRace === undefined || (currentRace(material, session.state) & target.data.xyzMaterialRace) !== 0;
}

function xyzMaterialAttributeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialAttribute === undefined || (currentAttribute(material, session.state) & target.data.xyzMaterialAttribute) !== 0;
}

function xyzMaterialTypeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialType === undefined || (cardTypeFlags(material, session.state) & target.data.xyzMaterialType) !== 0;
}

function xyzMaterialSetcodeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialSetcode === undefined || currentCardMatchesSetcode(material, session.state, target.data.xyzMaterialSetcode);
}

function xyzMaterialRankMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialRank === undefined || cardRank(session, material) === target.data.xyzMaterialRank;
}

function isMonsterLike(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1) !== 0;
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
