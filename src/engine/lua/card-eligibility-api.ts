import { hasZoneSpace } from "#duel/card-state.js";
import { canMoveDuelCardToLocation, canPlayerSpecialSummon, canSpecialSummonDuelCard } from "#duel/core.js";
import { isMaterialUsePrevented, type MaterialUseKind } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { isSetcodeMatch } from "#lua/card-code-utils.js";
import { cardLink, cardRank, cardTypeFlags } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

export function canBeMaterial(state: DuelState, card: DuelCardInstance | undefined, kind: MaterialUseKind, target?: DuelCardInstance): boolean {
  return Boolean(
    card &&
      isMonsterLike(card) &&
      canBeMaterialFromLocation(card.location, kind) &&
      targetAllowsMaterial(target, card, kind) &&
      !isMaterialUsePrevented(state, card.uid, kind, createLuaMaterialCheckContext(state)),
  );
}

export function canMoveCardToDeckOrExtraAsCost(state: DuelState, card: DuelCardInstance, uid: string): boolean {
  const destination: DuelLocation = card.kind === "extra" || isPendulumCard(card) ? "extraDeck" : "deck";
  return canMoveDuelCardToLocation(state, uid, destination, duelReason.cost);
}

export function canSpecialSummonFromLua(session: DuelSession, card: DuelCardInstance, player: PlayerId, summonType: number, zoneMask?: number): boolean {
  if (!hasAvailableMonsterZone(session, player, zoneMask)) return false;
  if (canSpecialSummonDuelCard(session.state, card.uid, player, summonType)) return true;
  return card.location === "extraDeck" && summonType !== 0 && hasZoneSpace(session.state, player, "monsterZone") && canPlayerSpecialSummon(session.state, player, card, summonType);
}

export function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
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

function targetAllowsMaterial(target: DuelCardInstance | undefined, card: DuelCardInstance, kind: MaterialUseKind): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const codes = cardCodes(card);
  if (kind === "fusion") return !target.data.fusionMaterials?.length || target.data.fusionMaterials.some((code) => codes.includes(code));
  if (kind === "ritual") return !target.data.ritualMaterials?.length || target.data.ritualMaterials.some((code) => codes.includes(code));
  if (kind === "synchro") {
    const materials = target.data.synchroMaterials;
    if (materials) {
      if (isTuner(card)) return codes.includes(materials.tuner);
      return materials.nonTuners.some((code) => codes.includes(code));
    }
    const targetLevel = cardTypeFlags(target) & 0x2000 ? target.data.level ?? 0 : 0;
    const materialLevel = card.data.level ?? 0;
    if (isTuner(card) && target.data.synchroTunerAttribute !== undefined && ((card.data.attribute ?? 0) & target.data.synchroTunerAttribute) === 0) return false;
    if (isTuner(card) && target.data.synchroTunerRace !== undefined && ((card.data.race ?? 0) & target.data.synchroTunerRace) === 0) return false;
    if (isTuner(card) && target.data.synchroTunerType !== undefined && (cardTypeFlags(card) & target.data.synchroTunerType) === 0) return false;
    if (isTuner(card) && target.data.synchroTunerSetcode !== undefined && !(card.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.synchroTunerSetcode!, setcode))) return false;
    if (!isTuner(card) && target.data.synchroNonTunerAttribute !== undefined && ((card.data.attribute ?? 0) & target.data.synchroNonTunerAttribute) === 0) return false;
    if (!isTuner(card) && target.data.synchroNonTunerRace !== undefined && ((card.data.race ?? 0) & target.data.synchroNonTunerRace) === 0) return false;
    if (!isTuner(card) && target.data.synchroNonTunerType !== undefined && (cardTypeFlags(card) & target.data.synchroNonTunerType) === 0) return false;
    if (!isTuner(card) && target.data.synchroNonTunerSetcode !== undefined && !(card.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.synchroNonTunerSetcode!, setcode))) return false;
    return targetLevel > 0 && materialLevel > 0 && materialLevel < targetLevel;
  }
  if (kind === "xyz") {
    if (target.data.xyzMaterials?.length) return target.data.xyzMaterials.some((code) => codes.includes(code));
    if (target.data.xyzMaterialRace !== undefined && ((card.data.race ?? 0) & target.data.xyzMaterialRace) === 0) return false;
    if (target.data.xyzMaterialAttribute !== undefined && ((card.data.attribute ?? 0) & target.data.xyzMaterialAttribute) === 0) return false;
    if (target.data.xyzMaterialType !== undefined && (cardTypeFlags(card) & target.data.xyzMaterialType) === 0) return false;
    if (target.data.xyzMaterialSetcode !== undefined && !(card.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.xyzMaterialSetcode!, setcode))) return false;
    const targetRank = cardRank(target);
    const materialLevel = card.data.level ?? 0;
    const materialRank = cardRank(card);
    return targetRank > 0 && (materialLevel === targetRank || (materialRank > 0 && targetRank === materialRank + 1));
  }
  if (kind === "link") {
    if (target.data.linkMaterialType !== undefined && (cardTypeFlags(card) & target.data.linkMaterialType) === 0) return false;
    if (target.data.linkMaterialRace !== undefined && ((card.data.race ?? 0) & target.data.linkMaterialRace) === 0) return false;
    if (target.data.linkMaterialAttribute !== undefined && ((card.data.attribute ?? 0) & target.data.linkMaterialAttribute) === 0) return false;
    if (target.data.linkMaterialSetcode !== undefined && !(card.data.setcodes ?? []).some((setcode) => isSetcodeMatch(target.data.linkMaterialSetcode!, setcode))) return false;
    return !target.data.linkMaterials?.length ? cardLink(target) > 0 && linkMaterialRating(card) <= cardLink(target) : target.data.linkMaterials.some((code) => codes.includes(code));
  }
  return true;
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1000000) !== 0;
}

function linkMaterialRating(card: DuelCardInstance): number {
  return cardLink(card) || 1;
}

function isTuner(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1000) !== 0;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}
