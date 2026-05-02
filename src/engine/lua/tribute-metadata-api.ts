import fengari from "fengari";
import type { DuelCardInstance } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function readMinTributeRequirement(L: unknown, card: DuelCardInstance | undefined): number {
  return readTributeRequirementField(L, card, "min_tribute_req");
}

export function readMaxTributeRequirement(L: unknown, card: DuelCardInstance | undefined): number {
  return readTributeRequirementField(L, card, "max_tribute_req");
}

function readTributeRequirementField(L: unknown, card: DuelCardInstance | undefined, fieldName: string): number {
  if (!card) return 0;
  lua.lua_getglobal(L, to_luastring(`c${card.code}`));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return 0;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? Math.max(0, lua.lua_tointeger(L, -1)) : 0;
  lua.lua_pop(L, 2);
  return value;
}
