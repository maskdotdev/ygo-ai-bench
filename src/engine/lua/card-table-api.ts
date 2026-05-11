import fengari from "fengari";
import { copyGlobalFunctionToField } from "#lua/api-utils.js";
import { cardFieldNames } from "#lua/card-field-names.js";

const { lua, to_luastring } = fengari;

export function installCardTableApi(L: unknown): void {
  lua.lua_pushcfunction(L, pushCardAdd);
  lua.lua_setfield(L, -2, to_luastring("__add"));
}

export function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  for (const fieldName of cardFieldNames) copyGlobalFunctionToField(L, "Card", fieldName);
  lua.lua_newtable(L);
  const code = codeFromUid(uid);
  if (code) {
    lua.lua_getglobal(L, to_luastring(`c${code}`));
    if (lua.lua_istable(L, -1)) lua.lua_setfield(L, -2, to_luastring("__index"));
    else lua.lua_pop(L, 1);
  }
  lua.lua_pushcfunction(L, pushCardEquals);
  lua.lua_setfield(L, -2, to_luastring("__eq"));
  copyGlobalFunctionToField(L, "Card", "__add");
  lua.lua_setmetatable(L, -2);
}

function codeFromUid(uid: string): string | undefined {
  const code = uid.split("-").at(-2);
  return code && /^\d+$/.test(code) ? code : undefined;
}

function pushCardAdd(L: unknown): number {
  lua.lua_getglobal(L, to_luastring("Group"));
  lua.lua_getfield(L, -1, to_luastring("__add"));
  lua.lua_pushvalue(L, 1);
  lua.lua_pushvalue(L, 2);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    lua.lua_newtable(L);
  }
  lua.lua_remove(L, -2);
  return 1;
}

function pushCardEquals(L: unknown): number {
  lua.lua_getfield(L, 1, to_luastring("__duel_uid"));
  lua.lua_getfield(L, 2, to_luastring("__duel_uid"));
  const left = lua.lua_isstring(L, -2) ? lua.lua_tojsstring(L, -2) : undefined;
  const right = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 2);
  lua.lua_pushboolean(L, left !== undefined && left === right);
  return 1;
}
