import fengari from "fengari";
import { copyGlobalFunctionToField, readCardUid, readGroupUids, readOptionalFunctionRef, readTableNumberField, releaseOptionalFunctionRef, setGroupUids } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { linkedZoneMaskForUids } from "#lua/duel-api/location.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaGroupApiState {
  selectedUids: string[];
}

export function installGroupApi(L: unknown, apiState: LuaGroupApiState = { selectedUids: [] }, session?: DuelSession): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids: string[] = [];
    const top = lua.lua_gettop(state);
    for (let index = 1; index <= top; index += 1) {
      const uid = readCardUid(state, index);
      if (uid) uids.push(uid);
    }
    pushGroupTable(state, uniqueUids(uids));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FromCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readGroupUids(state, 1);
    if (!uids[0]) {
      lua.lua_pushnil(state);
      return 1;
    }
    lua.lua_pushinteger(state, 1);
    lua.lua_setfield(state, 1, to_luastring("__group_cursor"));
    pushCardTable(state, uids[0]);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFirst"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readGroupUids(state, 1);
    const cursor = readTableNumberField(state, 1, "__group_cursor") ?? 0;
    const uid = uids[cursor];
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    lua.lua_pushinteger(state, cursor + 1);
    lua.lua_setfield(state, 1, to_luastring("__group_cursor"));
    pushCardTable(state, uid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetNext"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, readGroupUids(state, 1).length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushstring(state, to_luastring(`Group: { "size": ${readGroupUids(state, 1).length} }`));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("__tostring"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 2);
    if (uid) setGroupUids(state, 1, uniqueUids([...readGroupUids(state, 1), uid]));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("AddCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    setGroupUids(state, 1, uniqueUids([...readGroupUids(state, 1), ...readGroupUids(state, 2)]));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Merge"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const cardUid = readCardUid(state, 2);
    const removed = new Set(cardUid ? [cardUid] : readGroupUids(state, 2));
    setGroupUids(state, 1, readGroupUids(state, 1).filter((uid) => !removed.has(uid)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Sub"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    setGroupUids(state, 1, []);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Clear"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 2);
    if (uid) setGroupUids(state, 1, readGroupUids(state, 1).filter((candidate) => candidate !== uid));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RemoveCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 2);
    lua.lua_pushboolean(state, Boolean(uid && readGroupUids(state, 1).includes(uid)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsContains"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 2);
    lua.lua_pushboolean(state, Boolean(uid && readGroupUids(state, 1).includes(uid)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Contains"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, sameUidSet(readGroupUids(state, 1), readGroupUids(state, 2)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Equal"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const groupUids = readGroupUids(state, 1);
    const includedUids = readCardOrGroupUids(state, 2);
    lua.lua_pushboolean(state, includedUids.every((uid) => groupUids.includes(uid)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Includes"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const excluded = readCardOrGroupUids(state, 3);
    const uids = filterRef === undefined ? readGroupUids(state, 1) : readGroupUids(state, 1).filter((uid) => !excluded.includes(uid) && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 4)));
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Filter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const excluded = readCardOrGroupUids(state, 3);
    const matches: string[] = [];
    const nonMatches: string[] = [];
    for (const uid of readGroupUids(state, 1)) {
      if (excluded.includes(uid)) {
        nonMatches.push(uid);
        continue;
      }
      if (filterRef !== undefined && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 4))) matches.push(uid);
      else nonMatches.push(uid);
    }
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, matches);
    pushGroupTable(state, nonMatches);
    return 2;
  });
  lua.lua_setfield(L, -2, to_luastring("Split"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const excluded = readCardOrGroupUids(state, 3);
    const count = filterRef === undefined ? readGroupUids(state, 1).filter((uid) => !excluded.includes(uid)).length : readGroupUids(state, 1).filter((uid) => !excluded.includes(uid) && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 4))).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FilterCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const comparatorRef = readOptionalFunctionRef(state, 2);
    if (comparatorRef !== undefined) {
      const args = readFilterArgs(state, 3);
      setGroupUids(state, 1, readGroupUids(state, 1).sort((a, b) => compareGroupCards(state, a, b, comparatorRef, args)));
    }
    releaseOptionalFunctionRef(state, comparatorRef);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Sort"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const callbackRef = readOptionalFunctionRef(state, 2);
    if (callbackRef !== undefined) {
      const args = readFilterArgs(state, 3);
      for (const uid of readGroupUids(state, 1)) callGroupCardCallback(state, uid, callbackRef, args);
    }
    releaseOptionalFunctionRef(state, callbackRef);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ForEach"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, readGroupUids(state, 1));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Clone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const min = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const max = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : min;
    pushGroupTable(state, selectGroupUids(readGroupUids(state, 1), min, max));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Select"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const count = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    pushGroupTable(state, selectGroupUids(readGroupUids(state, 1), count, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RandomSelect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session ? linkedZoneMaskForUids(session, readGroupUids(state, 1)) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedZone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const count = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const excluded = readCardOrGroupUids(state, 4);
    const matches = filterRef === undefined ? readGroupUids(state, 1) : readGroupUids(state, 1).filter((uid) => !excluded.includes(uid) && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 5)));
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, matches.length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsExists"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const excluded = readCardOrGroupUids(state, 3);
    const candidates = readGroupUids(state, 1).filter((uid) => !excluded.includes(uid));
    const matches = filterRef !== undefined && candidates.length > 0 && candidates.every((uid) => groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 4)));
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, matches);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Match"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const classes = new Set<number>();
    if (filterRef !== undefined) {
      for (const uid of readGroupUids(state, 1)) {
        const value = groupCardFilterValue(state, uid, filterRef, readFilterArgs(state, 3));
        if (value !== undefined) classes.add(value);
      }
    }
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, classes.size);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetClassCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const common = filterRef === undefined ? 0 : commonBinaryProperty(state, readGroupUids(state, 1), filterRef, readFilterArgs(state, 3));
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, common !== 0);
    lua.lua_pushinteger(state, common);
    return 2;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckSameProperty"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const matches = filterRef === undefined || hasDistinctPropertyAssignment(state, readGroupUids(state, 1), filterRef, readFilterArgs(state, 3), false);
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, matches);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckDifferentProperty"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const matches = filterRef === undefined || hasDistinctPropertyAssignment(state, readGroupUids(state, 1), filterRef, readFilterArgs(state, 3), true);
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, matches);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckDifferentPropertyBinary"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    let mask = 0;
    if (filterRef !== undefined) {
      const args = readFilterArgs(state, 3);
      for (const uid of readGroupUids(state, 1)) mask |= groupCardFilterValue(state, uid, filterRef, args) ?? 0;
    }
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, bitCount(mask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetBinClassCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    let sum = 0;
    if (filterRef !== undefined) {
      const args = readFilterArgs(state, 3);
      for (const uid of readGroupUids(state, 1)) sum += groupCardFilterValue(state, uid, filterRef, args) ?? 0;
    }
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, sum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetSum"));
  lua.lua_pushcfunction(L, (state: unknown) => pushExtremeGroup(state, "max"));
  lua.lua_setfield(L, -2, to_luastring("GetMaxGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushExtremeGroup(state, "min"));
  lua.lua_setfield(L, -2, to_luastring("GetMinGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const sum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const min = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 1;
    const max = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : min;
    const selected = selectUidsWithSum(state, readGroupUids(state, 1), filterRef, sum, min, max, readFilterArgs(state, 6), apiState.selectedUids);
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, selected !== undefined);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const sum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const min = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 1;
    const max = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : min;
    const selected = selectUidsWithSumGreater(state, readGroupUids(state, 1), filterRef, sum, min, max, readFilterArgs(state, 6), apiState.selectedUids);
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, selected !== undefined);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 3);
    const sum = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const min = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const max = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : min;
    const selected = selectUidsWithSum(state, readGroupUids(state, 1), filterRef, sum, min, max, readFilterArgs(state, 7), apiState.selectedUids) ?? [];
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, selected);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 3);
    const sum = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const min = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const max = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : min;
    const selected = selectUidsWithSumGreater(state, readGroupUids(state, 1), filterRef, sum, min, max, readFilterArgs(state, 7), apiState.selectedUids) ?? [];
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, selected);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const min = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const max = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : min;
    const selected = selectSubGroup(state, readGroupUids(state, 1), filterRef, min, max, readFilterArgs(state, 5), apiState.selectedUids);
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, selected !== undefined);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckSubGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 3);
    const min = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const max = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : min;
    const selected = selectSubGroup(state, readGroupUids(state, 1), filterRef, min, max, readFilterArgs(state, 7), apiState.selectedUids) ?? [];
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, selected);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectSubGroup"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("KeepAlive"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("DeleteGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const selected = readGroupUids(state, 2);
    const min = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const max = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : min;
    const limit = max > 0 ? Math.max(Math.max(0, min), max) : readGroupUids(state, 1).length;
    if (selected.length >= limit) {
      lua.lua_pushnil(state);
      return 1;
    }
    const uid = readGroupUids(state, 1).find((candidate) => !selected.includes(candidate));
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectUnselect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const selected = readGroupUids(state, 2);
    const min = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const max = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : min;
    const filterRef = readOptionalFunctionRef(state, 7);
    const candidates = readGroupUids(state, 1).filter((uid) => !selected.includes(uid));
    const chosen = filterRef === undefined ? selectGroupUids(candidates, min, max) : selectSubGroup(state, candidates, filterRef, min, max, readFilterArgs(state, 8)) ?? [];
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, chosen);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectUnselectSubGroup"));
  lua.lua_setglobal(L, to_luastring("Group"));
}

export function pushGroupTable(L: unknown, uids: string[]): void {
  lua.lua_newtable(L);
  lua.lua_newtable(L);
  for (const [index, uid] of uids.entries()) {
    lua.lua_pushliteral(L, uid);
    lua.lua_rawseti(L, -2, index + 1);
  }
  lua.lua_setfield(L, -2, to_luastring("__group_uids"));
  for (const fieldName of groupFieldNames) copyGlobalFunctionToField(L, "Group", fieldName);
  lua.lua_newtable(L);
  copyGlobalFunctionToField(L, "Group", "__tostring");
  lua.lua_setmetatable(L, -2);
}

function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
}

function groupCardMatchesFilter(L: unknown, uid: string, filterRef: number, args: LuaFilterArgs): boolean {
  const value = groupCardFilterValue(L, uid, filterRef, args);
  return value === undefined ? false : value !== 0;
}

function groupCardFilterValue(L: unknown, uid: string, filterRef: number, args: LuaFilterArgs): number | undefined {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return undefined;
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : lua.lua_toboolean(L, -1) ? 1 : 0;
  lua.lua_pop(L, 1);
  return result;
}

function groupCardPropertyValues(L: unknown, uid: string, filterRef: number, args: LuaFilterArgs): number[] {
  const top = lua.lua_gettop(L);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, lua.LUA_MULTRET, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_settop(L, top);
    return [];
  }
  const values: number[] = [];
  for (let index = top + 1; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) values.push(lua.lua_tointeger(L, index));
  }
  lua.lua_settop(L, top);
  return values;
}

function commonBinaryProperty(L: unknown, uids: string[], filterRef: number, args: LuaFilterArgs): number {
  let common: number | undefined;
  for (const uid of uids) {
    const value = groupCardPropertyValues(L, uid, filterRef, args)[0] ?? 0;
    common = common === undefined ? value : common & value;
    if (common === 0) return 0;
  }
  return common ?? 0;
}

function hasDistinctPropertyAssignment(L: unknown, uids: string[], filterRef: number, args: LuaFilterArgs, binary: boolean): boolean {
  if (uids.length < 2) return true;
  const options = uids.map((uid) => binary ? binaryFlags(groupCardPropertyValues(L, uid, filterRef, args)[0] ?? 0) : groupCardPropertyValues(L, uid, filterRef, args));
  return assignDistinctProperty(options, 0, new Set());
}

function assignDistinctProperty(options: number[][], index: number, used: Set<number>): boolean {
  if (index >= options.length) return true;
  for (const value of options[index] ?? []) {
    if (value === 0 || used.has(value)) continue;
    used.add(value);
    if (assignDistinctProperty(options, index + 1, used)) return true;
    used.delete(value);
  }
  return false;
}

function binaryFlags(mask: number): number[] {
  const values: number[] = [];
  let bit = 1;
  while (bit <= mask) {
    if ((mask & bit) !== 0) values.push(bit);
    bit <<= 1;
  }
  return values;
}

function compareGroupCards(L: unknown, a: string, b: string, comparatorRef: number, args: LuaFilterArgs): number {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, comparatorRef);
  pushCardTable(L, a);
  pushCardTable(L, b);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 2 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return 0;
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : lua.lua_toboolean(L, -1) ? -1 : 1;
  lua.lua_pop(L, 1);
  return result;
}

function callGroupCardCallback(L: unknown, uid: string, callbackRef: number, args: LuaFilterArgs): void {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, callbackRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 0, 0);
  if (status !== lua.LUA_OK) {
    const message = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : "Group callback failed";
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  const top = lua.lua_gettop(L);
  return { start, count: Math.max(0, top - start + 1) };
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const uid = readCardUid(L, index);
  if (uid) return [uid];
  return readGroupUids(L, index);
}

function bitCount(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function selectGroupUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function pushExtremeGroup(L: unknown, direction: "max" | "min"): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const args = readFilterArgs(L, 3);
  const entries = filterRef === undefined
    ? []
    : readGroupUids(L, 1)
      .map((uid) => ({ uid, value: groupCardFilterValue(L, uid, filterRef, args) }))
      .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  releaseOptionalFunctionRef(L, filterRef);
  if (!entries.length) {
    pushGroupTable(L, []);
    lua.lua_pushinteger(L, 0);
    return 2;
  }
  const extreme = entries.reduce((best, entry) => direction === "max" ? Math.max(best, entry.value) : Math.min(best, entry.value), entries[0]!.value);
  pushGroupTable(L, entries.filter((entry) => entry.value === extreme).map((entry) => entry.uid));
  lua.lua_pushinteger(L, extreme);
  return 2;
}

function selectUidsWithSum(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs, selectedUids: string[] = []): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: groupCardFilterValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  const selected = selectedEntries(entries, selectedUids);
  return findSumSelection(entries.filter((entry) => !selected.some((candidate) => candidate.uid === entry.uid)), sum, boundedMin, boundedMax, 0, selected.map((entry) => entry.uid), selected.reduce((total, entry) => total + entry.value, 0));
}

function selectUidsWithSumGreater(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs, selectedUids: string[] = []): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: groupCardFilterValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  const selected = selectedEntries(entries, selectedUids);
  return findSumGreaterSelection(entries.filter((entry) => !selected.some((candidate) => candidate.uid === entry.uid)), sum, boundedMin, boundedMax, 0, selected.map((entry) => entry.uid), selected.reduce((total, entry) => total + entry.value, 0));
}

function selectedEntries(entries: { uid: string; value: number }[], selectedUids: string[]): { uid: string; value: number }[] {
  return uniqueUids(selectedUids)
    .map((uid) => entries.find((entry) => entry.uid === uid))
    .filter((entry): entry is { uid: string; value: number } => entry !== undefined);
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

function selectSubGroup(L: unknown, uids: string[], filterRef: number | undefined, min: number, max: number, args: LuaFilterArgs, selectedUids: string[] = []): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const selected = uniqueUids(selectedUids).filter((uid) => uids.includes(uid));
  return findSubGroupSelection(L, uids.filter((uid) => !selected.includes(uid)), filterRef, boundedMin, boundedMax, args, 0, selected);
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

const groupFieldNames = [
  "GetFirst",
  "GetNext",
  "GetCount",
  "__tostring",
  "AddCard",
  "Merge",
  "Sub",
  "Clear",
  "RemoveCard",
  "IsContains",
  "Contains",
  "Equal",
  "Includes",
  "Filter",
  "Split",
  "FilterCount",
  "Sort",
  "ForEach",
  "Clone",
  "Select",
  "RandomSelect",
  "GetLinkedZone",
  "IsExists",
  "Match",
  "GetClassCount",
  "CheckSameProperty",
  "CheckDifferentProperty",
  "CheckDifferentPropertyBinary",
  "GetBinClassCount",
  "GetSum",
  "GetMaxGroup",
  "GetMinGroup",
  "CheckWithSumEqual",
  "SelectWithSumEqual",
  "CheckWithSumGreater",
  "SelectWithSumGreater",
  "CheckSubGroup",
  "SelectSubGroup",
  "KeepAlive",
  "DeleteGroup",
  "SelectUnselect",
  "SelectUnselectSubGroup",
];

function sameUidSet(a: string[], b: string[]): boolean {
  const uniqueA = uniqueUids(a);
  const uniqueB = uniqueUids(b);
  return uniqueA.length === uniqueB.length && uniqueA.every((uid) => uniqueB.includes(uid));
}
