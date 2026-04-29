import fengari from "fengari";
import { damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/core.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelLpApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, session.state.players[player].lifePoints);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    setDuelPlayerLifePoints(session.state, player, value);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    lua.lua_pushboolean(state, session.state.players[player].lifePoints > value);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckLPCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    if (session.state.players[player].lifePoints > value) setDuelPlayerLifePoints(session.state, player, session.state.players[player].lifePoints - value);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("PayLPCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, damageDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, recoverDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Recover"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
