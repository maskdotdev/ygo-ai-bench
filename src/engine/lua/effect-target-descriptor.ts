import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

export function knownLuaEffectTargetDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const cardParam = luaFunctionParams(snippet)?.[1];
  if (!cardParam) return undefined;
  const card = escapeRegExp(cardParam);
  const nonFusionExtra = new RegExp(
    `\\breturn\\s+not\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_FUSION|64)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`,
  );
  if (nonFusionExtra.test(snippet)) return "special-summon-limit:non-fusion-extra";
  const notSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const setcode = notSetcode?.[1] ? luaNumberTokenValue(L, notSetcode[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? `target:not-setcode:${setcode}` : undefined;
}

const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

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
