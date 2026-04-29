import fengari from "fengari";
import { pushCardTable } from "./lua-card-api.js";
import { installDuelLocationApi } from "./lua-duel-location-api.js";
import { pushGroupTable } from "./lua-group-api.js";
import { locationsFromMask, readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "./lua-api-utils.js";
import type { DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelQueryApiHostState {
  activeTargetUids: string[] | undefined;
  operatedUids: string[];
}

export function installDuelQueryApi(L: unknown, session: DuelSession, hostState: LuaDuelQueryApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsExistingMatchingCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsExistingMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsExistingMatchingCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsExistingTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTargetCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstMatchingCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFirstMatchingCard"));
  installDuelLocationApi(L, session);
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session, hostState.activeTargetUids));
  lua.lua_setfield(L, -2, to_luastring("SelectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstTarget(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetFirstTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.activeTargetUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTargetCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.operatedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperatedGroup"));
}

function pushMatchingGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const uids = matchingCardUidsWithFilter(L, session, query);
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, uids);
  return 1;
}

function pushMatchingGroupCount(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const count = matchingCardUidsWithFilter(L, session, query).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushFieldGroup(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  pushGroupTable(L, fieldGroupUids(session, player, selfMask, opponentMask));
  return 1;
}

function pushFieldGroupCount(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  lua.lua_pushinteger(L, fieldGroupUids(session, player, selfMask, opponentMask).length);
  return 1;
}

function pushFieldCard(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const locationMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const sequence = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const uid = matchingCardUids(session, player, locationMask)[sequence];
  if (!uid) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, uid);
  return 1;
}

function pushIsExistingMatchingCard(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 6, 7);
  const minimum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1;
  const count = matchingCardUidsWithFilter(L, session, query).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, count >= minimum);
  return 1;
}

function pushTargetCount(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const count = matchingCardUidsWithFilter(L, session, query).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushFirstMatchingCard(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const uid = matchingCardUidsWithFilter(L, session, query)[0];
  releaseOptionalFunctionRef(L, query.filterRef);
  if (!uid) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, uid);
  return 1;
}

function pushSelectedMatchingGroup(L: unknown, session: DuelSession, targetUids?: string[]): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 8, 9);
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const limit = max > 0 ? max : Math.max(min, 1);
  const selected = matchingCardUidsWithFilter(L, session, query).slice(0, limit);
  releaseOptionalFunctionRef(L, query.filterRef);
  if (targetUids) targetUids.splice(0, targetUids.length, ...selected);
  pushGroupTable(L, selected);
  return 1;
}

function pushFirstTarget(L: unknown, hostState: LuaDuelQueryApiHostState): number {
  const target = hostState.activeTargetUids?.[0];
  if (!target) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, target);
  return 1;
}

function readMatchingQuery(L: unknown, session: DuelSession, filterIndex: number, playerIndex: number, selfIndex: number, opponentIndex: number, excludedIndex: number, argsIndex: number): MatchingQuery {
  return {
    filterRef: readOptionalFunctionRef(L, filterIndex),
    player: normalizePlayer(lua.lua_isnumber(L, playerIndex) ? lua.lua_tointeger(L, playerIndex) : session.state.turnPlayer),
    selfMask: lua.lua_isnumber(L, selfIndex) ? lua.lua_tointeger(L, selfIndex) : 0,
    opponentMask: lua.lua_isnumber(L, opponentIndex) ? lua.lua_tointeger(L, opponentIndex) : 0,
    excluded: readCardOrGroupUids(L, excludedIndex),
    args: readFilterArgs(L, argsIndex),
  };
}

interface MatchingQuery {
  filterRef: number | undefined;
  player: PlayerId;
  selfMask: number;
  opponentMask: number;
  excluded: string[];
  args: LuaFilterArgs;
}

function matchingCardUidsWithFilter(L: unknown, session: DuelSession, query: MatchingQuery): string[] {
  return fieldGroupUids(session, query.player, query.selfMask, query.opponentMask).filter((uid) => !query.excluded.includes(uid) && cardMatchesFilter(L, uid, query.filterRef, query.args));
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  return { start, count: Math.max(0, lua.lua_gettop(L) - start + 1) };
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
