import fengari from "fengari";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

export function luaFunctionSourceSnippet(L: unknown, index: number, hostState: Pick<LuaHostState, "loadedScriptBodies">): string | undefined {
  const location = luaFunctionSourceLocation(L, index);
  if (!location) return undefined;
  const source = hostState.loadedScriptBodies.get(location.source);
  if (!source) return undefined;
  return source.split(/\r?\n/).slice(location.line - 1, location.lastLine).join(" ");
}

export function luaFunctionParams(snippet: string): string[] | undefined {
  const match = snippet.match(/function(?:\s+[A-Za-z_][\w.]*\s*)?\(([^)]*)\)/);
  return match?.[1]?.split(",").map((part) => part.trim()).filter(Boolean);
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
