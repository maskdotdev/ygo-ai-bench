import fengari from "fengari";
import { getDuelFlagEffectCount, registerDuelFlagEffect, resetDuelFlagEffect } from "./duel-flags.js";
import type { DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export function installDuelFlagApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const value = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    registerDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code, reset, property, value);
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, resetDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
