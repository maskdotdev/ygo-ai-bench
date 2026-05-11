import type { DuelCardInstance, DuelSummonType } from "#duel/types.js";

export const luaSummonTypeNormal = 0x10000000;
export const luaSummonTypeTribute = 0x11000000;
export const luaSummonTypeFlip = 0x20000000;
export const luaSummonTypeSpecial = 0x40000000;
export const luaSummonTypeFusion = 0x43000000;
export const luaSummonTypeRitual = 0x45000000;
export const luaSummonTypeSynchro = 0x46000000;
export const luaSummonTypeXyz = 0x49000000;
export const luaSummonTypePendulum = 0x4a000000;
export const luaSummonTypeLink = 0x4c000000;

export function effectiveSpecialSummonTypeCode(summonTypeCode?: number): number {
  return summonTypeCode && summonTypeCode !== 0 ? summonTypeCode : luaSummonTypeSpecial;
}

export function luaSpecialSummonTypeCode(summonTypeCode: number): number {
  return summonTypeCode !== 0 && summonTypeCode < luaSummonTypeSpecial ? luaSummonTypeSpecial + summonTypeCode : summonTypeCode;
}

export function summonProcedureTypeCodeFromValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isSafeInteger(value)) return undefined;
  return (value & luaSummonTypeSpecial) === luaSummonTypeSpecial ? value : undefined;
}

export function isFaceDownExtraDeckSummonTypeCode(summonTypeCode: number | undefined): boolean {
  const summonType = duelSummonTypeFromCode(summonTypeCode);
  return summonType === "fusion" || summonType === "synchro" || summonType === "xyz" || summonType === "link" || isCustomSpecialSummonTypeCode(summonTypeCode);
}

export function summonTypeCodeFromDuelSummonType(summonType: DuelSummonType): number {
  if (summonType === "fusion") return luaSummonTypeFusion;
  if (summonType === "ritual") return luaSummonTypeRitual;
  if (summonType === "synchro") return luaSummonTypeSynchro;
  if (summonType === "xyz") return luaSummonTypeXyz;
  if (summonType === "pendulum") return luaSummonTypePendulum;
  if (summonType === "link") return luaSummonTypeLink;
  return luaSummonTypeSpecial;
}

export function duelSummonTypeFromCode(summonTypeCode?: number): DuelSummonType {
  const code = effectiveSpecialSummonTypeCode(summonTypeCode);
  if ((code & luaSummonTypeFusion) === luaSummonTypeFusion) return "fusion";
  if ((code & luaSummonTypeRitual) === luaSummonTypeRitual) return "ritual";
  if ((code & luaSummonTypeSynchro) === luaSummonTypeSynchro) return "synchro";
  if ((code & luaSummonTypeXyz) === luaSummonTypeXyz) return "xyz";
  if ((code & luaSummonTypePendulum) === luaSummonTypePendulum) return "pendulum";
  if ((code & luaSummonTypeLink) === luaSummonTypeLink) return "link";
  return "special";
}

export function summonTypeMaskFromCard(card: Pick<DuelCardInstance, "summonType" | "summonTypeCode"> | undefined): number {
  if (card?.summonTypeCode !== undefined) return card.summonTypeCode;
  if (!card?.summonType) return 0;
  if (card.summonType === "normal") return luaSummonTypeNormal;
  if (card.summonType === "tribute") return luaSummonTypeTribute;
  if (card.summonType === "flip") return luaSummonTypeFlip;
  if (card.summonType === "fusion") return luaSummonTypeFusion;
  if (card.summonType === "ritual") return luaSummonTypeRitual;
  if (card.summonType === "synchro") return luaSummonTypeSynchro;
  if (card.summonType === "xyz") return luaSummonTypeXyz;
  if (card.summonType === "pendulum") return luaSummonTypePendulum;
  if (card.summonType === "link") return luaSummonTypeLink;
  return luaSummonTypeSpecial;
}

export function isSummonTypeMaskMatch(actual: number, requested: number): boolean {
  if (actual === 0 || requested === 0) return false;
  return actual === requested || (actual & requested) === requested;
}

function isCustomSpecialSummonTypeCode(summonTypeCode: number | undefined): boolean {
  return summonTypeCode !== undefined && summonTypeCode !== 0 && summonTypeCode !== luaSummonTypeSpecial && duelSummonTypeFromCode(summonTypeCode) === "special";
}
