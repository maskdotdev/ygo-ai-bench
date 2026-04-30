import fengari from "fengari";
import { getDuelFlagEffectCount, getDuelFlagEffectLabel, registerDuelFlagEffect, resetDuelFlagEffect, setDuelFlagEffectLabel } from "#duel/flags.js";
import { readCardUid } from "#lua/api-utils.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardFlagApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? Math.trunc(lua.lua_tonumber(state, 3)) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const value = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    if (!uid) {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code, reset, property, value);
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    lua.lua_pushboolean(state, Boolean(uid && getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) >= minimum));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("HasFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, uid ? setDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code, value) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}
