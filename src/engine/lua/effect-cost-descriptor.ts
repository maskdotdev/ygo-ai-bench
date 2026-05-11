import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

export function knownLuaEffectCostDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const summonTypeParam = luaFunctionParams(snippet)?.[3];
  if (!summonTypeParam) return undefined;
  const comparison = new RegExp(`\\breturn\\s+${escapeRegExp(summonTypeParam)}\\s*(==|~=)\\s*(SUMMON_TYPE_SPECIAL\\s*\\+\\s*${numericOrIdentifierPattern}|${numericOrIdentifierPattern})`);
  const match = snippet.match(comparison);
  const value = match?.[2] ? luaSummonTypeTokenValue(L, match[2]) : undefined;
  if (value === undefined) return undefined;
  return match?.[1] === "==" ? `cost:special-summon-type-is:${value}` : `cost:special-summon-type-not:${value}`;
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

function luaSummonTypeTokenValue(L: unknown, token: string): number | undefined {
  const parts = token.split("+").map((part) => part.trim());
  if (parts.length === 2 && parts[0] === "SUMMON_TYPE_SPECIAL" && parts[1] !== undefined) {
    const detail = luaNumberTokenValue(L, parts[1]);
    return detail === undefined ? undefined : 0x40000000 + detail;
  }
  return luaNumberTokenValue(L, token);
}

function luaNumberTokenValue(L: unknown, token: string): number | undefined {
  if (/^0x[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[A-Za-z_]\w*$/.test(token)) return undefined;
  lua.lua_getglobal(L, to_luastring(token));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
