import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

export function knownLuaEffectCostDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  if (isGlobalFunction(L, index, "Cost", "SelfTribute") || isGlobalFunction(L, index, "Cost", "SelfRelease")) return "cost:self-tribute";
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  if (releaseGroupCostCanFreeMonsterZone(snippet)) return "cost:release-group-can-free-mzone";
  const summonTypeParam = luaFunctionParams(snippet)?.[3];
  if (!summonTypeParam) return undefined;
  const comparison = new RegExp(`\\breturn\\s+${escapeRegExp(summonTypeParam)}\\s*(==|~=)\\s*(SUMMON_TYPE_SPECIAL\\s*\\+\\s*${numericOrIdentifierPattern}|${numericOrIdentifierPattern})`);
  const match = snippet.match(comparison);
  const value = match?.[2] ? luaSummonTypeTokenValue(L, index, match[2]) : undefined;
  if (value === undefined) return undefined;
  return match?.[1] === "==" ? `cost:special-summon-type-is:${value}` : `cost:special-summon-type-not:${value}`;
}

function releaseGroupCostCanFreeMonsterZone(snippet: string): boolean {
  return (
    /\bDuel\s*\.\s*GetLocationCount\s*\([^)]*\bLOCATION_MZONE\b/.test(snippet) &&
    /\bDuel\s*\.\s*CheckReleaseGroupCost\s*\(/.test(snippet) &&
    /\bDuel\s*\.\s*SelectReleaseGroupCost\s*\(/.test(snippet) &&
    /\bDuel\s*\.\s*Release\s*\([^)]*\bREASON_COST\b/.test(snippet)
  );
}

export function specialSummonTypeIsCostDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("cost:special-summon-type-is:")) return undefined;
  const value = Number(descriptor.slice("cost:special-summon-type-is:".length));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function specialSummonTypeNotCostDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("cost:special-summon-type-not:")) return undefined;
  const value = Number(descriptor.slice("cost:special-summon-type-not:".length));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function luaSummonTypeTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  const parts = token.split("+").map((part) => part.trim());
  if (parts.length === 2 && parts[0] === "SUMMON_TYPE_SPECIAL" && parts[1] !== undefined) {
    const detail = luaNumberTokenValue(L, functionIndex, parts[1]);
    return detail === undefined ? undefined : 0x40000000 + detail;
  }
  return luaNumberTokenValue(L, functionIndex, token);
}

function luaNumberTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  if (/^0x[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[A-Za-z_]\w*$/.test(token)) return undefined;
  lua.lua_getglobal(L, to_luastring(token));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value ?? luaNumberUpvalueValue(L, functionIndex, token);
}

function luaNumberUpvalueValue(L: unknown, index: number, token: string): number | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return undefined;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    const value = name === token && lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
    lua.lua_pop(L, 1);
    if (value !== undefined) return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGlobalFunction(L: unknown, index: number, tableName: string, fieldName: string): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring(tableName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const matches = lua.lua_isfunction(L, -1) && Boolean(lua.lua_rawequal(L, absoluteIndex, -1));
  lua.lua_pop(L, 2);
  return matches;
}
