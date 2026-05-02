import fengari from "fengari";
import { auxUtilitySource } from "#lua/aux-utility-source-api.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installAuxUtilityApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const status = lauxlib.luaL_dostring(L, to_luastring(auxUtilitySource));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
