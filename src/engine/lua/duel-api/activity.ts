import fengari from "fengari";
import { duelActivity, getDuelActivityCount } from "#duel/activity.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelActivityApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const activity = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : duelActivity.summon;
    lua.lua_pushinteger(state, getDuelActivityCount(session.state, player, activity));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetActivityCount"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
