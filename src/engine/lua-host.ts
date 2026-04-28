import fengari from "fengari";
import type { DuelSession } from "./duel-types.js";

const { lua, lauxlib, lualib, to_luastring } = fengari;

export interface LuaScriptLoadResult {
  ok: boolean;
  error?: string;
  name: string;
}

export interface LuaScriptHost {
  readonly messages: string[];
  loadScript(code: string, name: string): LuaScriptLoadResult;
  getGlobalString(name: string): string | undefined;
  getGlobalNumber(name: string): number | undefined;
}

export function createLuaScriptHost(session: DuelSession): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const messages: string[] = [];
  lualib.luaL_openlibs(L);
  installConstants(L);
  installDebugApi(L, messages);
  installDuelApi(L, session, messages);
  installEffectApi(L);
  installGroupApi(L);

  return {
    messages,
    loadScript(code, name) {
      const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(name));
      if (loadStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
      if (callStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      return { ok: true, name };
    },
    getGlobalString(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
    getGlobalNumber(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
  };
}

function installConstants(L: unknown): void {
  const constants: Record<string, number> = {
    LOCATION_DECK: 0x01,
    LOCATION_HAND: 0x02,
    LOCATION_MZONE: 0x04,
    LOCATION_SZONE: 0x08,
    LOCATION_GRAVE: 0x10,
    LOCATION_REMOVED: 0x20,
    LOCATION_EXTRA: 0x40,
    POS_FACEUP_ATTACK: 0x1,
    POS_FACEDOWN_DEFENSE: 0x8,
    EFFECT_TYPE_IGNITION: 0x10,
    EFFECT_TYPE_TRIGGER_O: 0x20,
    EVENT_SUMMON_SUCCESS: 0x40,
  };
  for (const [name, value] of Object.entries(constants)) {
    lua.lua_pushinteger(L, value);
    lua.lua_setglobal(L, to_luastring(name));
  }
}

function installDebugApi(L: unknown, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Message"));
  lua.lua_setglobal(L, to_luastring("Debug"));
}

function installDuelApi(L: unknown, session: DuelSession, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushliteral(state, session.state.phase);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_setglobal(L, to_luastring("Duel"));
}

function installEffectApi(L: unknown): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_newtable(state);
    lua.lua_pushcfunction(state, () => 0);
    lua.lua_setfield(state, -2, to_luastring("SetType"));
    lua.lua_pushcfunction(state, () => 0);
    lua.lua_setfield(state, -2, to_luastring("SetCode"));
    lua.lua_pushcfunction(state, () => 0);
    lua.lua_setfield(state, -2, to_luastring("SetOperation"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateEffect"));
  lua.lua_setglobal(L, to_luastring("Effect"));
}

function installGroupApi(L: unknown): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_newtable(state);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateGroup"));
  lua.lua_setglobal(L, to_luastring("Group"));
}

function readLuaError(L: unknown): string {
  const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
  lua.lua_pop(L, 1);
  return message;
}
