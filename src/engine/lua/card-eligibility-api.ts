import { hasZoneSpace } from "#duel/card-state.js";
import { canMoveDuelCardToLocation, canPlayerSpecialSummon, canSpecialSummonDuelCard } from "#duel/core.js";
import { isMaterialUsePrevented, type MaterialUseKind } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { isSummonTypeMaskMatch, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { currentCardCodes, currentCardMatchesSetcode, currentLinkMaterialCodes, currentLinkMaterialMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentLink, currentRace, currentRank } from "#duel/card-stats.js";
import type { CardPosition, DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

export function canBeMaterial(state: DuelState, card: DuelCardInstance | undefined, kind: MaterialUseKind, target?: DuelCardInstance, reason = duelReason.material): boolean {
  if (kind === "xyz" && (reason & duelReason.effect) !== 0) return canBeEffectXyzMaterial(state, card, target, reason);
  return Boolean(
    card &&
      isMonsterLike(card, state) &&
      canBeMaterialFromLocation(card.location, kind) &&
      targetAllowsMaterial(state, target, card, kind) &&
      !isMaterialUsePrevented(state, card.uid, kind, createLuaMaterialCheckContext(state)),
  );
}

function canBeEffectXyzMaterial(state: DuelState, card: DuelCardInstance | undefined, target: DuelCardInstance | undefined, reason: number): boolean {
  return Boolean(
    card &&
      card.uid !== target?.uid &&
      canMoveDuelCardToLocation(state, card.uid, "overlay", reason) &&
      !isMaterialUsePrevented(state, card.uid, "xyz", createLuaMaterialCheckContext(state)),
  );
}

export function canMoveCardToDeckOrExtraAsCost(state: DuelState, card: DuelCardInstance, uid: string): boolean {
  const destination: DuelLocation = card.kind === "extra" || isPendulumCard(card, state) ? "extraDeck" : "deck";
  return canMoveDuelCardToLocation(state, uid, destination, duelReason.cost);
}

export function canSpecialSummonFromLua(session: DuelSession, card: DuelCardInstance, player: PlayerId, summonType: number, zoneMask?: number, allowUnconditionalSpecialSummonCondition = false, summonPosition?: CardPosition): boolean {
  if (!hasAvailableMonsterZone(session, player, zoneMask)) return false;
  if (canSpecialSummonDuelCard(session.state, card.uid, player, summonType, undefined, allowUnconditionalSpecialSummonCondition, summonPosition)) return true;
  return card.location === "extraDeck" && summonType !== 0 && hasZoneSpace(session.state, player, "monsterZone") && canPlayerSpecialSummon(session.state, player, card, summonType, undefined, summonPosition);
}

export function isMonsterLike(card: DuelCardInstance, state?: DuelState): boolean {
  return (cardTypeFlags(card, state) & 0x1) !== 0;
}

function canBeMaterialFromLocation(location: DuelLocation, kind: MaterialUseKind): boolean {
  if (kind === "fusion" || kind === "ritual") return location === "hand" || location === "monsterZone";
  return location === "monsterZone";
}

function hasAvailableMonsterZone(session: DuelSession, player: PlayerId, zoneMask: number | undefined): boolean {
  if (zoneMask === undefined || zoneMask === 0) return hasZoneSpace(session.state, player, "monsterZone");
  const occupied = new Set(session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone").map((card) => card.sequence));
  for (let sequence = 0; sequence < 5; sequence += 1) {
    if ((zoneMask & (1 << sequence)) !== 0 && !occupied.has(sequence)) return true;
  }
  return false;
}

function targetAllowsMaterial(state: DuelState, target: DuelCardInstance | undefined, card: DuelCardInstance, kind: MaterialUseKind): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const codes = currentCardCodes(card, state);
  if (kind === "fusion") return !target.data.fusionMaterials?.length || target.data.fusionMaterials.some((code) => codes.includes(code));
  if (kind === "ritual") return !target.data.ritualMaterials?.length || target.data.ritualMaterials.some((code) => codes.includes(code));
  if (kind === "synchro") {
    const materials = target.data.synchroMaterials;
    if (materials) {
      if (isTuner(state, card)) return codes.includes(materials.tuner);
      return materials.nonTuners.some((code) => codes.includes(code));
    }
    const targetLevel = cardTypeFlags(target, state) & 0x2000 ? currentLevel(target, state) : 0;
    const materialLevel = currentLevel(card, state);
    const tuner = isTuner(state, card);
    if (tuner && target.data.synchroTunerLevel !== undefined && currentLevel(card, state) !== target.data.synchroTunerLevel) return false;
    if (tuner && target.data.synchroTunerAttribute !== undefined && (currentAttribute(card, state) & target.data.synchroTunerAttribute) === 0) return false;
    if (tuner && target.data.synchroTunerRace !== undefined && (currentRace(card, state) & target.data.synchroTunerRace) === 0) return false;
    if (tuner && target.data.synchroTunerType !== undefined && (cardTypeFlags(card, state) & target.data.synchroTunerType) === 0) return false;
    if (tuner && target.data.synchroTunerSetcode !== undefined && !currentCardMatchesSetcode(card, state, target.data.synchroTunerSetcode)) return false;
    if (!tuner && target.data.synchroNonTunerAttribute !== undefined && (currentAttribute(card, state) & target.data.synchroNonTunerAttribute) === 0) return false;
    if (!tuner && target.data.synchroNonTunerRace !== undefined && (currentRace(card, state) & target.data.synchroNonTunerRace) === 0) return false;
    if (!tuner && target.data.synchroNonTunerType !== undefined && (cardTypeFlags(card, state) & target.data.synchroNonTunerType) === 0) return false;
    if (!tuner && target.data.synchroNonTunerSetcode !== undefined && !currentCardMatchesSetcode(card, state, target.data.synchroNonTunerSetcode)) return false;
    return targetLevel > 0 && materialLevel > 0 && materialLevel < targetLevel;
  }
  if (kind === "xyz") {
    if (target.data.xyzMaterials?.length) return target.data.xyzMaterials.some((code) => codes.includes(code));
    if (target.data.xyzMaterialRace !== undefined && (currentRace(card, state) & target.data.xyzMaterialRace) === 0) return false;
    if (target.data.xyzMaterialAttribute !== undefined && (currentAttribute(card, state) & target.data.xyzMaterialAttribute) === 0) return false;
    if (target.data.xyzMaterialType !== undefined && (cardTypeFlags(card, state) & target.data.xyzMaterialType) === 0) return false;
    if (target.data.xyzMaterialSetcode !== undefined && !currentCardMatchesSetcode(card, state, target.data.xyzMaterialSetcode)) return false;
    if (target.data.xyzMaterialRank !== undefined && currentRank(card, state) !== target.data.xyzMaterialRank) return false;
    const targetRank = currentRank(target, state);
    const materialLevel = currentLevel(card, state);
    const materialRank = currentRank(card, state);
    return targetRank > 0 && (materialLevel === targetRank || (materialRank > 0 && targetRank === materialRank + 1));
  }
  if (kind === "link") {
    if (target.data.linkMaterialType !== undefined && (cardTypeFlags(card, state) & target.data.linkMaterialType) === 0) return false;
    if (target.data.linkMaterialRace !== undefined && (currentRace(card, state) & target.data.linkMaterialRace) === 0) return false;
    if (target.data.linkMaterialAttribute !== undefined && (currentAttribute(card, state) & target.data.linkMaterialAttribute) === 0) return false;
    if (target.data.linkMaterialSetcode !== undefined && !currentLinkMaterialMatchesSetcode(card, state, target.data.linkMaterialSetcode)) return false;
    if (target.data.linkMaterialSummonType !== undefined && !isSummonTypeMaskMatch(summonTypeMaskFromCard(card), target.data.linkMaterialSummonType)) return false;
    if (target.data.linkMaterialLevel !== undefined && currentLevel(card, state) !== target.data.linkMaterialLevel) return false;
    if (target.data.linkMaterialMinLevel !== undefined && currentLevel(card, state) < target.data.linkMaterialMinLevel) return false;
    return !target.data.linkMaterials?.length ? currentLink(target, state) > 0 && linkMaterialRating(card, state) <= currentLink(target, state) : target.data.linkMaterials.some((code) => currentLinkMaterialCodes(card, state).includes(code));
  }
  return true;
}

function isPendulumCard(card: DuelCardInstance, state?: DuelState): boolean {
  return (cardTypeFlags(card, state) & 0x1000000) !== 0;
}

function linkMaterialRating(card: DuelCardInstance, state: DuelState): number {
  return currentLink(card, state) || 1;
}

function isTuner(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1000) !== 0;
}
