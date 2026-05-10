import fengari from "fengari";
import { luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

export function luaSimpleSetcodeCardFilter(L: unknown, index: number, hostState: Pick<LuaHostState, "loadedScriptBodies">): number | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const match = snippet.match(
    new RegExp(`function(?:\\s+[A-Za-z_][\\w.]*\\s*)?\\(\\s*([A-Za-z_]\\w*)\\s*\\)\\s*return\\s+\\1\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*end\\b`),
  );
  if (!match?.[2]) return undefined;
  const setcode = luaNumberTokenValue(L, index, match[2]);
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
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
