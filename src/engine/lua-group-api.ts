import fengari from "fengari";
import { copyGlobalFunctionToField, readCardUid, readGroupUids, readOptionalFunctionRef, readTableNumberField, releaseOptionalFunctionRef, setGroupUids } from "./lua-api-utils.js";
import { pushCardTable } from "./lua-card-api.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export function installGroupApi(L: unknown): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readGroupUids(state, 1);
    if (!uids[0]) {
      lua.lua_pushnil(state);
      return 1;
    }
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
    const filterRef = readOptionalFunctionRef(state, 2);
    const excluded = readCardUid(state, 3);
    const uids = filterRef === undefined ? readGroupUids(state, 1) : readGroupUids(state, 1).filter((uid) => uid !== excluded && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 4)));
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Filter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, readGroupUids(state, 1));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Clone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const min = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const max = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : min;
    const limit = max > 0 ? max : Math.max(min, 1);
    pushGroupTable(state, readGroupUids(state, 1).slice(0, limit));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Select"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const count = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const excluded = readCardUid(state, 4);
    const matches = filterRef === undefined ? readGroupUids(state, 1) : readGroupUids(state, 1).filter((uid) => uid !== excluded && groupCardMatchesFilter(state, uid, filterRef, readFilterArgs(state, 5)));
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, matches.length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsExists"));
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
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("KeepAlive"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("DeleteGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, readGroupUids(state, 1));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectUnselect"));
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

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  const top = lua.lua_gettop(L);
  return { start, count: Math.max(0, top - start + 1) };
}

const groupFieldNames = [
  "GetFirst",
  "GetNext",
  "GetCount",
  "AddCard",
  "Merge",
  "RemoveCard",
  "IsContains",
  "Filter",
  "Clone",
  "Select",
  "IsExists",
  "GetClassCount",
  "KeepAlive",
  "DeleteGroup",
  "SelectUnselect",
];
