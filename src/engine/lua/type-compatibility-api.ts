import fengari from "fengari";

const { lua, to_luastring } = fengari;

export function installTypeCompatibilityApi(L: unknown): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushstring(state, to_luastring(compatibilityTypeName(state, 1)));
    return 1;
  });
  lua.lua_setglobal(L, to_luastring("type"));
}

function compatibilityTypeName(L: unknown, index: number): string {
  if (!lua.lua_istable(L, index)) return nativeTypeName(lua.lua_type(L, index));
  if (tableHasStringField(L, index, "__duel_uid")) return "Card";
  if (tableHasTableField(L, index, "__group_uids")) return "Group";
  if (tableHasNumberField(L, index, "__effect_id")) return "Effect";
  return "table";
}

function nativeTypeName(type: number): string {
  switch (type) {
    case lua.LUA_TNIL:
      return "nil";
    case lua.LUA_TBOOLEAN:
      return "boolean";
    case lua.LUA_TLIGHTUSERDATA:
      return "userdata";
    case lua.LUA_TNUMBER:
      return "number";
    case lua.LUA_TSTRING:
      return "string";
    case lua.LUA_TTABLE:
      return "table";
    case lua.LUA_TFUNCTION:
      return "function";
    case lua.LUA_TUSERDATA:
      return "userdata";
    case lua.LUA_TTHREAD:
      return "thread";
    default:
      return "no value";
  }
}

function tableHasStringField(L: unknown, index: number, fieldName: string): boolean {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const hasField = lua.lua_isstring(L, -1);
  lua.lua_pop(L, 1);
  return hasField;
}

function tableHasNumberField(L: unknown, index: number, fieldName: string): boolean {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const hasField = lua.lua_isnumber(L, -1);
  lua.lua_pop(L, 1);
  return hasField;
}

function tableHasTableField(L: unknown, index: number, fieldName: string): boolean {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const hasField = lua.lua_istable(L, -1);
  lua.lua_pop(L, 1);
  return hasField;
}
