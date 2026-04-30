import fengari from "fengari";
import { scriptFilenameForCard } from "#engine/data-loaders.js";
import type { LuaScriptLoadResult } from "#lua/host.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelScriptApiHostState {
  currentScriptCardCode: string | undefined;
  loadScriptFile(name: string, forced?: boolean): LuaScriptLoadResult;
}

export function installDuelScriptApi(L: unknown, hostState: LuaDuelScriptApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushEnableUnofficialMask(state, "RACE_ALL"));
  lua.lua_setfield(L, -2, to_luastring("EnableUnofficialRace"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEnableUnofficialMask(state, "ATTRIBUTE_ALL"));
  lua.lua_setfield(L, -2, to_luastring("EnableUnofficialAttribute"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const name = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : undefined;
    if (!name) {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    const forced = Boolean(lua.lua_toboolean(state, 2));
    const result = hostState.loadScriptFile(name, forced);
    lua.lua_pushboolean(state, result.ok);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("LoadScript"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const name = readCardScriptName(state);
    if (!name) {
      lua.lua_pushnil(state);
      return 1;
    }
    hostState.loadScriptFile(name);
    pushCardScriptTable(state, scriptCodeFromName(name));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("LoadCardScript"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const currentCode = hostState.currentScriptCardCode;
    const aliasName = readCardScriptName(state);
    if (!currentCode || !aliasName) return 0;
    hostState.loadScriptFile(aliasName);
    lua.lua_getglobal(state, to_luastring(`c${scriptCodeFromName(aliasName)}`));
    lua.lua_setglobal(state, to_luastring(`c${currentCode}`));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("LoadCardScriptAlias"));
}

function pushEnableUnofficialMask(L: unknown, globalName: string): number {
  const value = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  lua.lua_getglobal(L, to_luastring(globalName));
  const existing = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
  lua.lua_pop(L, 1);
  lua.lua_pushinteger(L, existing | value);
  lua.lua_setglobal(L, to_luastring(globalName));
  return 0;
}

function readCardScriptName(L: unknown): string | undefined {
  if (lua.lua_isnumber(L, 1)) return scriptFilenameForCard(lua.lua_tointeger(L, 1));
  if (!lua.lua_isstring(L, 1)) return undefined;
  const value = lua.lua_tojsstring(L, 1);
  if (!value) return undefined;
  return /^\d+$/.test(value) ? scriptFilenameForCard(value) : value;
}

function scriptCodeFromName(name: string): string {
  return /^c(\d+)\.lua$/.exec(name)?.[1] ?? name.replace(/\.lua$/, "").replace(/^c/, "");
}

function pushCardScriptTable(L: unknown, code: string): void {
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  if (lua.lua_istable(L, -1)) return;
  lua.lua_pop(L, 1);
  lua.lua_newtable(L);
  lua.lua_pushvalue(L, -1);
  lua.lua_setglobal(L, to_luastring(`c${code}`));
}
