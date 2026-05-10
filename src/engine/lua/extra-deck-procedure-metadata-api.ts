import fengari from "fengari";
import type { DuelCardInstance } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function applyLuaExtraDeckProcedureMetadata(L: unknown, card: DuelCardInstance): void {
  const xyzCount = readProcedureNumberField(L, card, "xyz_materials", 3);
  if (xyzCount !== undefined) card.data.xyzMaterialCount = xyzCount;
  const linkMin = readProcedureNumberField(L, card, "link_materials", 2);
  const linkMax = readProcedureNumberField(L, card, "link_materials", 3);
  if (linkMin !== undefined) card.data.linkMaterialMin = linkMin;
  if (linkMax !== undefined) card.data.linkMaterialMax = linkMax;
}

function readProcedureNumberField(L: unknown, card: DuelCardInstance, fieldName: string, index: number): number | undefined {
  lua.lua_getglobal(L, to_luastring(`c${card.code}`));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  lua.lua_rawgeti(L, -1, index);
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 3);
  return value !== undefined && value > 0 ? value : undefined;
}
