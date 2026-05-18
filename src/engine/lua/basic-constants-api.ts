import fengari from "fengari";
import { luaArchetypeSetcodeNumericConstants } from "#lua/basic-archetype-setcode-constant-data.js";
import { luaCardCounterListConstants, luaCardCounterNumericConstants } from "#lua/basic-card-counter-constant-data.js";
import { luaNumericConstants } from "#lua/basic-constant-data.js";
import { luaDuelOptionNumericConstants } from "#lua/basic-duel-option-constant-data.js";
import { luaHintOpcodeNumericConstants } from "#lua/basic-hint-opcode-constant-data.js";
import { luaProcedureNumericConstants } from "#lua/basic-procedure-constant-data.js";
import { toLuaSigned32 } from "#lua/numeric-utils.js";

const { lua, to_luastring } = fengari;

export function installConstants(L: unknown): void {
  for (const constants of [
    luaNumericConstants,
    luaArchetypeSetcodeNumericConstants,
    luaCardCounterNumericConstants,
    luaDuelOptionNumericConstants,
    luaHintOpcodeNumericConstants,
    luaProcedureNumericConstants,
  ]) {
    for (const [name, value] of Object.entries(constants)) {
      pushLuaNumericConstant(L, value);
      lua.lua_setglobal(L, to_luastring(name));
    }
  }
  for (const [name, values] of Object.entries(luaCardCounterListConstants)) {
    lua.lua_newtable(L);
    for (const [index, value] of values.entries()) {
      pushLuaNumericConstant(L, value);
      lua.lua_rawseti(L, -2, index + 1);
    }
    lua.lua_setglobal(L, to_luastring(name));
  }
}

function pushLuaNumericConstant(L: unknown, value: number): void {
  const signed = toLuaSigned32(value);
  if (signed !== undefined) lua.lua_pushinteger(L, signed);
  else lua.lua_pushnumber(L, value);
}
