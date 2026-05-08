import fengari from "fengari";
import type { LuaDuelChainApiHostState } from "#lua/duel-api/chain.js";

const { lua, to_luastring, to_jsstring } = fengari;

const TYPE_ACTION = 0x10000000;

export function literalActionTypeChainPlayerLimitPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  const chainPlayerParam = params?.[2];
  const captured = capturedSinglePlayerUpvalue(L, index);
  if (!effectParam || !chainPlayerParam || !captured) return undefined;
  const effect = escapeRegExp(effectParam);
  const chainPlayer = escapeRegExp(chainPlayerParam);
  const capturedName = escapeRegExp(captured.name);
  const typeCheck = `${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_ACTION|${TYPE_ACTION})\\s*\\)`;
  const mismatchedPlayer = `(?:${chainPlayer}\\s*~=\\s*1\\s*-\\s*${capturedName}|1\\s*-\\s*${capturedName}\\s*~=\\s*${chainPlayer})`;
  const matches = new RegExp(`\\breturn\\s+not\\s*\\(\\s*${typeCheck}\\s+and\\s+${mismatchedPlayer}\\s*\\)`).test(snippet);
  return matches ? `closure:not-source-type-unless-chain-player:${TYPE_ACTION}:${1 - captured.value}` : undefined;
}

function luaFunctionSourceSnippet(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const location = luaFunctionSourceLocation(L, index);
  if (!location) return undefined;
  const source = hostState.loadedScriptBodies?.get(location.source);
  if (!source) return undefined;
  return source.split(/\r?\n/).slice(location.line - 1, location.lastLine).join(" ");
}

function luaFunctionSourceLocation(L: unknown, index: number): { source: string; line: number; lastLine: number } | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring("debug"));
  lua.lua_getfield(L, -1, to_luastring("getinfo"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  lua.lua_pushstring(L, to_luastring("S"));
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK || !lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  const source = readStringField(L, -1, "source");
  const line = readIntegerField(L, -1, "linedefined");
  const lastLine = readIntegerField(L, -1, "lastlinedefined");
  lua.lua_pop(L, 2);
  if (!source || line === undefined || lastLine === undefined || line < 1 || lastLine < line) return undefined;
  return { source, line, lastLine };
}

function readStringField(L: unknown, tableIndex: number, field: string): string | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readIntegerField(L: unknown, tableIndex: number, field: string): number | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function capturedSinglePlayerUpvalue(L: unknown, index: number): { name: string; value: 0 | 1 } | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  let captured: { name: string; value: 0 | 1 } | undefined;
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return captured;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (captured || !lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      const value = lua.lua_tointeger(L, -1);
      if (value !== 0 && value !== 1) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      captured = { name, value };
    }
    lua.lua_pop(L, 1);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
