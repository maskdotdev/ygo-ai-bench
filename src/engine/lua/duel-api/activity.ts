import fengari from "fengari";
import { duelActivity, getDuelActivityCount } from "#duel/activity.js";
import { pushCardTable } from "#lua/card-api.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import { readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelActivityRecord, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelActivityApiHostState {
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installDuelActivityApi(L: unknown, session: DuelSession, hostState: LuaDuelActivityApiHostState): void {
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
    lua.lua_pushinteger(state, getCustomActivityCount(state, session, hostState, customCounters, id, player, activity));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCustomActivityCount"));
}

interface CustomActivityCounter {
  id: number;
  activity: number;
  filterRef: number;
}

function getCustomActivityCount(
  L: unknown,
  session: DuelSession,
  hostState: LuaDuelActivityApiHostState,
  counters: CustomActivityCounter[],
  id: number,
  player: PlayerId,
  activity: number,
): number {
  const counter = findCustomCounter(counters, id, activity);
  if (!counter) return 0;
  return session.state.activityHistory.filter((record) => record.player === player && record.activity === activity && !customActivityAllows(L, session, hostState, counter, record)).length;
}

function findCustomCounter(counters: CustomActivityCounter[], id: number, activity: number): CustomActivityCounter | undefined {
  for (let index = counters.length - 1; index >= 0; index -= 1) {
    const counter = counters[index];
    if (counter && counter.id === id && counter.activity === activity) return counter;
  }
  return undefined;
}

function customActivityAllows(
  L: unknown,
  session: DuelSession,
  hostState: LuaDuelActivityApiHostState,
  counter: CustomActivityCounter,
  record: DuelActivityRecord,
): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, counter.filterRef);
  pushCustomActivitySubjectTable(L, session, hostState, record);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushCustomActivitySubjectTable(
  L: unknown,
  session: DuelSession,
  hostState: LuaDuelActivityApiHostState,
  record: DuelActivityRecord,
): void {
  if (record.activity === duelActivity.chain) {
    pushActivityEffectTable(L, session, hostState, record);
    return;
  }
  if (record.cardUid === undefined) lua.lua_pushnil(L);
  else pushCardTable(L, record.cardUid);
}

function pushActivityEffectTable(
  L: unknown,
  session: DuelSession,
  hostState: LuaDuelActivityApiHostState,
  record: DuelActivityRecord,
): void {
  const luaEffectId = Number(record.effectId?.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(luaEffectId)) {
    hostState.pushEffectTable(L, luaEffectId);
    return;
  }
  pushActivityEffectProxy(L, session, record.cardUid);
}

function pushActivityEffectProxy(L: unknown, session: DuelSession, cardUid: string | undefined): void {
  const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (card) pushCardTable(state, card.uid);
    else lua.lua_pushnil(state);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetHandler"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, requested !== 0 && (activeTypeFlags(card, session) & requested) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsActiveType"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, (activeTypeFlags(card, session) & 0x1) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsMonsterEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, (activeTypeFlags(card, session) & 0x2) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSpellEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, (activeTypeFlags(card, session) & 0x4) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsTrapEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, (activeTypeFlags(card, session) & 0x6) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSpellTrapEffect"));
}

function activeTypeFlags(card: DuelCardInstance | undefined, session: DuelSession): number {
  return cardTypeFlags(card, session.state);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
