import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import { installDuelLocationApi } from "#lua/duel-api/location.js";
import { pushGroupTable } from "#lua/group-api.js";
import { locationsFromMask, readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelQueryApiHostState {
  activeTargetUids: string[] | undefined;
  activeContext: DuelEffectContext | undefined;
  operatedUids: string[];
  selectedUids: string[];
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
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckWithSumEqual(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectWithSumEqual(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckWithSumGreater(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectWithSumGreater(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckSubGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckSubGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectSubGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectSubGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session, hostState.activeTargetUids));
  lua.lua_setfield(L, -2, to_luastring("SelectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstTarget(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetFirstTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, effectiveTargetUids(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTargetCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (hostState.activeTargetUids) hostState.activeTargetUids.splice(0, hostState.activeTargetUids.length, ...uniqueUids(readCardOrGroupUids(state, 1)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetCard"));
  lua.lua_pushcfunction(L, () => {
    if (hostState.activeTargetUids) hostState.activeTargetUids.splice(0, hostState.activeTargetUids.length);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ClearTargetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const target = readOptionalPlayer(state, 1);
    if (target !== undefined) hostState.activeContext?.setTargetPlayer(target);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (lua.lua_isnumber(state, 1)) hostState.activeContext?.setTargetParam(lua.lua_tointeger(state, 1));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetParam"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.operatedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperatedGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    hostState.selectedUids.splice(0, hostState.selectedUids.length, ...uniqueUids(readCardOrGroupUids(state, 1)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetSelectedCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.selectedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetSelectedCard"));
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
  const selected = selectMatchingUids(matchingCardUidsWithFilter(L, session, query), min, max);
  releaseOptionalFunctionRef(L, query.filterRef);
  if (targetUids) targetUids.splice(0, targetUids.length, ...selected);
  pushGroupTable(L, selected);
  return 1;
}

function pushCheckWithSumEqual(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 8, 9);
  const sum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const selected = selectUidsWithSum(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushCheckWithSumGreater(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 8, 9);
  const sum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const selected = selectUidsWithSumGreater(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushSelectWithSumEqual(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 9, 10);
  const sum = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0;
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectUidsWithSum(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushSelectWithSumGreater(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 9, 10);
  const sum = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0;
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectUidsWithSumGreater(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushCheckSubGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 7, 8);
  const min = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1;
  const max = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : min;
  const selected = selectSubGroup(L, matchingCardUidsForQuery(session, query), query.filterRef, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushSelectSubGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 4, 5, 6, 9, 10);
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectSubGroup(L, matchingCardUidsForQuery(session, query), query.filterRef, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushFirstTarget(L: unknown, session: DuelSession, hostState: LuaDuelQueryApiHostState): number {
  const target = effectiveTargetUids(session, hostState)[0];
  if (!target) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, target);
  return 1;
}

function effectiveTargetUids(session: DuelSession, hostState: LuaDuelQueryApiHostState): string[] {
  if (hostState.activeTargetUids?.length) return hostState.activeTargetUids;
  if (hostState.activeContext?.chainLink) return hostState.activeContext.targetUids;
  const chainTargetUids = session.state.chain[session.state.chain.length - 1]?.targetUids;
  return chainTargetUids ?? [];
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
  return matchingCardUidsForQuery(session, query).filter((uid) => cardMatchesFilter(L, uid, query.filterRef, query.args));
}

function matchingCardUidsForQuery(session: DuelSession, query: MatchingQuery): string[] {
  return fieldGroupUids(session, query.player, query.selfMask, query.opponentMask).filter((uid) => !query.excluded.includes(uid));
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

function selectMatchingUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function cardFilterNumberValue(L: unknown, uid: string, filterRef: number, args: LuaFilterArgs): number | undefined {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return undefined;
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : lua.lua_toboolean(L, -1) ? 1 : 0;
  lua.lua_pop(L, 1);
  return result;
}

function selectUidsWithSum(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: cardFilterNumberValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  return findSumSelection(entries, sum, boundedMin, boundedMax, 0, [], 0);
}

function selectUidsWithSumGreater(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: cardFilterNumberValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  return findSumGreaterSelection(entries, sum, boundedMin, boundedMax, 0, [], 0);
}

function findSumSelection(entries: { uid: string; value: number }[], target: number, min: number, max: number, index: number, selected: string[], current: number): string[] | undefined {
  if (current === target && selected.length >= min && selected.length <= max) return [...selected];
  if (index >= entries.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < entries.length; nextIndex += 1) {
    const entry = entries[nextIndex];
    if (!entry) continue;
    selected.push(entry.uid);
    const found = findSumSelection(entries, target, min, max, nextIndex + 1, selected, current + entry.value);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function findSumGreaterSelection(entries: { uid: string; value: number }[], target: number, min: number, max: number, index: number, selected: string[], current: number): string[] | undefined {
  if (current >= target && selected.length >= min && selected.length <= max) return [...selected];
  if (index >= entries.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < entries.length; nextIndex += 1) {
    const entry = entries[nextIndex];
    if (!entry) continue;
    selected.push(entry.uid);
    const found = findSumGreaterSelection(entries, target, min, max, nextIndex + 1, selected, current + entry.value);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function selectSubGroup(L: unknown, uids: string[], filterRef: number | undefined, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findSubGroupSelection(L, uids, filterRef, boundedMin, boundedMax, args, 0, []);
}

function findSubGroupSelection(L: unknown, uids: string[], filterRef: number, min: number, max: number, args: LuaFilterArgs, index: number, selected: string[]): string[] | undefined {
  if (selected.length >= min && selected.length <= max && groupPredicateMatches(L, selected, filterRef, args)) return [...selected];
  if (index >= uids.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < uids.length; nextIndex += 1) {
    const uid = uids[nextIndex];
    if (!uid) continue;
    selected.push(uid);
    const found = findSubGroupSelection(L, uids, filterRef, min, max, args, nextIndex + 1, selected);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function groupPredicateMatches(L: unknown, uids: string[], filterRef: number, args: LuaFilterArgs): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushGroupTable(L, uids);
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

function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
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

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
