import fengari from "fengari";
import { cardProcedureSource } from "#lua/card-procedure-source-api.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installCardProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const status = lauxlib.luaL_dostring(L, to_luastring(cardProcedureSource));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
