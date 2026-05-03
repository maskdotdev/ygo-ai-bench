import fengari from "fengari";
import { luaNumericConstants } from "#lua/basic-constant-data.js";
import { luaDuelOptionNumericConstants } from "#lua/basic-duel-option-constant-data.js";
import { luaHintOpcodeNumericConstants } from "#lua/basic-hint-opcode-constant-data.js";
import { luaProcedureNumericConstants } from "#lua/basic-procedure-constant-data.js";

const { lua, to_luastring } = fengari;

export function installConstants(L: unknown): void {
  for (const constants of [luaNumericConstants, luaDuelOptionNumericConstants, luaHintOpcodeNumericConstants, luaProcedureNumericConstants]) {
    for (const [name, value] of Object.entries(constants)) {
      pushLuaNumericConstant(L, value);
      lua.lua_setglobal(L, to_luastring(name));
    }
  }
}

function pushLuaNumericConstant(L: unknown, value: number): void {
  if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) lua.lua_pushinteger(L, value);
  else lua.lua_pushnumber(L, value);
}
