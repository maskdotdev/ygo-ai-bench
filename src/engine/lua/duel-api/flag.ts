import fengari from "fengari";
import { getDuelFlagEffectCount, getDuelFlagEffectLabel, registerDuelFlagEffect, resetDuelFlagEffect, setDuelFlagEffectLabel } from "#duel/flags.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelFlagApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const mask = lua.lua_isnumber(state, 1) ? Math.trunc(lua.lua_tonumber(state, 1)) : 0;
    lua.lua_pushboolean(state, hasAllFlags(session.state.duelTypeFlags, mask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDuelType"));
  lua.lua_pushcfunction(L, () => {
    session.state.unofficialProcEnabled = true;
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("EnableUnofficialProc"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const flag = lua.lua_isnumber(state, 1) ? Math.trunc(lua.lua_tonumber(state, 1)) : 0;
    if (flag > 0) session.state.globalFlags = Number(BigInt(session.state.globalFlags) | BigInt(flag));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("EnableGlobalFlag"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? Math.trunc(lua.lua_tonumber(state, 3)) : 0;
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
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    lua.lua_pushboolean(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code) >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("HasFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, getDuelFlagEffectLabel(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, setDuelFlagEffectLabel(session.state, { ownerType: "player", ownerId: player }, code, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, resetDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}

function hasAllFlags(flags: number, mask: number): boolean {
  if (!Number.isFinite(flags) || !Number.isFinite(mask) || mask <= 0) return false;
  return (BigInt(Math.trunc(flags)) & BigInt(Math.trunc(mask))) === BigInt(Math.trunc(mask));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
