import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { isSetcodeMatch } from "#lua/card-code-utils.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

export function canLuaXyzSummonCard(session: DuelSession, card: DuelCardInstance, suppliedUids: string[]): boolean {
  if (card.location !== "extraDeck" || !isMonsterLike(card)) return false;
  const supplied = new Set(suppliedUids);
  const materialPool = session.state.cards.filter((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && canBeXyzMaterial(session, candidate, card));
  if ([...supplied].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return false;
  const count = xyzMaterialCount(card);
  if (supplied.size > count) return false;
  for (const materials of cardCombinations(materialPool, count)) {
    if ([...supplied].some((uid) => !materials.some((material) => material.uid === uid))) continue;
    if ((card.data.xyzMaterials?.length ? materialCodesMatch(materials, card.data.xyzMaterials) : canGenericXyzMaterialsMatch(card, materials)) && hasSummonZoneAfterMaterials(session, card.controller, materials)) return true;
  }
  return false;
}

function hasSummonZoneAfterMaterials(session: DuelSession, player: PlayerId, materials: DuelCardInstance[]): boolean {
  return hasZoneSpace(session.state, player, "monsterZone") || materials.some((material) => material.controller === player && material.location === "monsterZone");
}

function canBeXyzMaterial(session: DuelSession, card: DuelCardInstance, target: DuelCardInstance): boolean {
  if (!isMonsterLike(card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(target, card) && !isMaterialUsePrevented(session.state, card.uid, "xyz", createMaterialCheckContext(session));
}

function targetAllowsMaterial(target: DuelCardInstance, card: DuelCardInstance): boolean {
  if (target.data.xyzMaterials?.length) return target.data.xyzMaterials.some((code) => cardCodes(card).includes(code));
  if (!xyzMaterialRaceMatches(target, card)) return false;
  if (!xyzMaterialAttributeMatches(target, card)) return false;
  if (!xyzMaterialTypeMatches(target, card)) return false;
  if (!xyzMaterialSetcodeMatches(target, card)) return false;
  const targetRank = cardRank(target);
  return targetRank > 0 && (card.data.level ?? 0) === targetRank;
}

function canGenericXyzMaterialsMatch(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetRank = cardRank(card);
  return targetRank > 0 && materials.length === xyzMaterialCount(card) && materials.every((material) => (material.data.level ?? 0) === targetRank && xyzMaterialRaceMatches(card, material) && xyzMaterialAttributeMatches(card, material) && xyzMaterialTypeMatches(card, material) && xyzMaterialSetcodeMatches(card, material));
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

function cardRank(card: DuelCardInstance): number {
  return (cardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
}

function xyzMaterialCount(card: DuelCardInstance): number {
  return card.data.xyzMaterials?.length || card.data.xyzMaterialCount || 2;
}

function xyzMaterialRaceMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialRace === undefined || ((material.data.race ?? 0) & target.data.xyzMaterialRace) !== 0;
}

function xyzMaterialAttributeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialAttribute === undefined || ((material.data.attribute ?? 0) & target.data.xyzMaterialAttribute) !== 0;
}

function xyzMaterialTypeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialType === undefined || (cardTypeFlags(material) & target.data.xyzMaterialType) !== 0;
}

function xyzMaterialSetcodeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialSetcode === undefined || (material.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.xyzMaterialSetcode!, setcode));
}

function cardTypeFlags(card: DuelCardInstance): number {
  return card.data.typeFlags ?? (card.kind === "spell" ? 0x2 : card.kind === "trap" ? 0x4 : 0x1);
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
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
