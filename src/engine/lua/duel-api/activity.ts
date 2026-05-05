import fengari from "fengari";
import { duelActivity, getDuelActivityCount } from "#duel/activity.js";
import { pushCardTable } from "#lua/card-api.js";
import { readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelActivityApi(L: unknown, session: DuelSession): void {
  const customCounters: CustomActivityCounter[] = [];
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const activity = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : duelActivity.summon;
    lua.lua_pushinteger(state, getDuelActivityCount(session.state, player, activity));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetActivityCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, getDuelActivityCount(session.state, player, duelActivity.attack));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetBattledCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, session.state.phaseActivity);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckPhaseActivity"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const activity = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : duelActivity.summon;
    const filterRef = readOptionalFunctionRef(state, 3);
    if (session.state.status === "ended") {
      releaseOptionalFunctionRef(state, filterRef);
      return 0;
    }
    if (filterRef !== undefined) customCounters.push({ id, activity, filterRef });
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("AddCustomActivityCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const activity = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelActivity.summon;
    lua.lua_pushinteger(state, getCustomActivityCount(state, session, customCounters, id, player, activity));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCustomActivityCount"));
}

interface CustomActivityCounter {
  id: number;
  activity: number;
  filterRef: number;
}

function getCustomActivityCount(L: unknown, session: DuelSession, counters: CustomActivityCounter[], id: number, player: PlayerId, activity: number): number {
  const counter = findCustomCounter(counters, id, activity);
  if (!counter) return 0;
  return session.state.activityHistory.filter((record) => record.player === player && record.activity === activity && !customActivityAllows(L, counter, record.cardUid)).length;
}

function findCustomCounter(counters: CustomActivityCounter[], id: number, activity: number): CustomActivityCounter | undefined {
  for (let index = counters.length - 1; index >= 0; index -= 1) {
    const counter = counters[index];
    if (counter && counter.id === id && counter.activity === activity) return counter;
  }
  return undefined;
}

function customActivityAllows(L: unknown, counter: CustomActivityCounter, cardUid: string | undefined): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, counter.filterRef);
  if (cardUid === undefined) lua.lua_pushnil(L);
  else pushCardTable(L, cardUid);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
