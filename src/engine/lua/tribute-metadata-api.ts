import fengari from "fengari";
import type { DuelCardInstance } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function readMinTributeRequirement(L: unknown, card: DuelCardInstance | undefined): number | undefined {
  return readTributeRequirementField(L, card, "min_tribute_req");
}

export function readMaxTributeRequirement(L: unknown, card: DuelCardInstance | undefined): number | undefined {
  return readTributeRequirementField(L, card, "max_tribute_req");
}

export function applyLuaNormalTributeMetadata(L: unknown, card: DuelCardInstance): void {
  const min = readMinTributeRequirement(L, card);
  const max = readMaxTributeRequirement(L, card);
  if (min === undefined && max === undefined) return;
  const base = baseNormalTributeCount(card);
  card.data.normalTributeMin = min ?? card.data.normalTributeMin ?? base;
  card.data.normalTributeMax = max ?? card.data.normalTributeMax ?? card.data.normalTributeMin;
  if (min !== max) delete card.data.normalTributes;
  if (min === max && min !== undefined) card.data.normalTributes = min;
}

export function withLuaMinTributeOverride<T>(card: DuelCardInstance, minTributes: number | undefined, readValue: () => T): T {
  if (minTributes === undefined) return readValue();
  const previousExact = card.data.normalTributes;
  const previousMin = card.data.normalTributeMin;
  const previousMax = card.data.normalTributeMax;
  const maxTributes = Math.max(minTributes, previousExact ?? previousMax ?? baseNormalTributeCount(card));
  try {
    delete card.data.normalTributes;
    card.data.normalTributeMin = minTributes;
    card.data.normalTributeMax = maxTributes;
    return readValue();
  } finally {
    restoreOptionalNumber(card.data, "normalTributes", previousExact);
    restoreOptionalNumber(card.data, "normalTributeMin", previousMin);
    restoreOptionalNumber(card.data, "normalTributeMax", previousMax);
  }
}

function readTributeRequirementField(L: unknown, card: DuelCardInstance | undefined, fieldName: string): number | undefined {
  if (!card) return undefined;
  lua.lua_getglobal(L, to_luastring(`c${card.code}`));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? Math.max(0, lua.lua_tointeger(L, -1)) : undefined;
  lua.lua_pop(L, 2);
  return value;
}

function restoreOptionalNumber(target: DuelCardInstance["data"], field: "normalTributes" | "normalTributeMin" | "normalTributeMax", value: number | undefined): void {
  if (value === undefined) delete target[field];
  else target[field] = value;
}

function baseNormalTributeCount(card: DuelCardInstance): number {
  const level = card.data.level ?? 0;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}
