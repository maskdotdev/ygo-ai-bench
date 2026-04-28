import fengari from "fengari";
import type { CardPosition, DuelLocation } from "./duel-types.js";

const { lua, lauxlib, to_luastring } = fengari;

export function copyGlobalFunctionToField(L: unknown, tableName: string, fieldName: string): void {
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  lua.lua_setfield(L, -3, to_luastring(fieldName));
  lua.lua_pop(L, 1);
}

export function readTableStringField(L: unknown, index: number, fieldName: string): string | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

export function readTableNumberField(L: unknown, index: number, fieldName: string): number | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

export function readCardUid(L: unknown, index: number): string | undefined {
  if (!lua.lua_istable(L, index)) return undefined;
  return readTableStringField(L, index, "__duel_uid");
}

export function readGroupUids(L: unknown, index: number): string[] {
  if (!lua.lua_istable(L, index)) return [];
  lua.lua_getfield(L, index, to_luastring("__group_uids"));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return [];
  }
  const count = lua.lua_rawlen(L, -1);
  const uids: string[] = [];
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, -1, luaIndex);
    const uid = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
    if (uid) uids.push(uid);
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1);
  return uids;
}

export function setGroupUids(L: unknown, index: number, uids: string[]): void {
  lua.lua_newtable(L);
  for (const [luaIndex, uid] of uids.entries()) {
    lua.lua_pushliteral(L, uid);
    lua.lua_rawseti(L, -2, luaIndex + 1);
  }
  lua.lua_setfield(L, index, to_luastring("__group_uids"));
}

export function readOptionalFunctionRef(L: unknown, index: number): number | undefined {
  if (!lua.lua_isfunction(L, index)) return undefined;
  lua.lua_pushvalue(L, index);
  return lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
}

export function releaseOptionalFunctionRef(L: unknown, ref: number | undefined): void {
  if (ref !== undefined) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
}

export function locationsFromMask(mask: number): DuelLocation[] {
  const locations: DuelLocation[] = [];
  if ((mask & 0x01) !== 0) locations.push("deck");
  if ((mask & 0x02) !== 0) locations.push("hand");
  if ((mask & 0x04) !== 0) locations.push("monsterZone");
  if ((mask & 0x08) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x10) !== 0) locations.push("graveyard");
  if ((mask & 0x20) !== 0) locations.push("banished");
  if ((mask & 0x40) !== 0) locations.push("extraDeck");
  return locations;
}

export function positionFromMask(mask: number): CardPosition | undefined {
  if ((mask & 0x1) !== 0) return "faceUpAttack";
  if ((mask & 0x4) !== 0) return "faceUpDefense";
  if ((mask & 0x8) !== 0) return "faceDownDefense";
  return undefined;
}
