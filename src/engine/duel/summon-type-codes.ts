import type { DuelSummonType } from "#duel/types.js";

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
