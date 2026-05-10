import fengari from "fengari";
import { luaNumericConstants } from "#lua/basic-constant-data.js";
import type { DuelCardInstance } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function applyLuaExtraDeckProcedureMetadata(L: unknown, card: DuelCardInstance, source?: string): void {
  const synchroTunerMin = readProcedureNumberField(L, card, "synchro_materials", 2);
  const synchroTunerMax = readProcedureNumberField(L, card, "synchro_materials", 3);
  const synchroNonTunerMin = readProcedureNumberField(L, card, "synchro_materials", 5);
  const synchroNonTunerMax = readProcedureNumberField(L, card, "synchro_materials", 6);
  if (synchroTunerMin !== undefined) card.data.synchroTunerMin = synchroTunerMin;
  if (synchroTunerMax !== undefined) card.data.synchroTunerMax = synchroTunerMax;
  if (synchroNonTunerMin !== undefined) card.data.synchroNonTunerMin = synchroNonTunerMin;
  if (synchroNonTunerMax !== undefined) card.data.synchroNonTunerMax = synchroNonTunerMax;
  const synchroTunerAttribute = readSynchroProcedureTunerAttributeFilter(source);
  if (synchroTunerAttribute !== undefined) card.data.synchroTunerAttribute = synchroTunerAttribute;
  const synchroTunerRace = readSynchroProcedureTunerRaceFilter(source);
  if (synchroTunerRace !== undefined) card.data.synchroTunerRace = synchroTunerRace;
  const xyzCount = readProcedureNumberField(L, card, "xyz_materials", 3);
  if (xyzCount !== undefined) card.data.xyzMaterialCount = xyzCount;
  const xyzRace = readXyzProcedureRaceFilter(source);
  if (xyzRace !== undefined) card.data.xyzMaterialRace = xyzRace;
  const xyzAttribute = readXyzProcedureAttributeFilter(source);
  if (xyzAttribute !== undefined) card.data.xyzMaterialAttribute = xyzAttribute;
  const xyzType = readXyzProcedureTypeFilter(source);
  if (xyzType !== undefined) card.data.xyzMaterialType = xyzType;
  const linkMin = readProcedureNumberField(L, card, "link_materials", 2);
  const linkMax = readProcedureNumberField(L, card, "link_materials", 3);
  if (linkMin !== undefined) card.data.linkMaterialMin = linkMin;
  if (linkMax !== undefined) card.data.linkMaterialMax = linkMax;
  const linkType = readLinkProcedureTypeFilter(source);
  if (linkType !== undefined) card.data.linkMaterialType = linkType;
  const linkRace = readLinkProcedureRaceFilter(source);
  if (linkRace !== undefined) card.data.linkMaterialRace = linkRace;
  const linkAttribute = readLinkProcedureAttributeFilter(source);
  if (linkAttribute !== undefined) card.data.linkMaterialAttribute = linkAttribute;
}

function readXyzProcedureRaceFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Xyz\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsRace\s*,\s*(RACE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readSynchroProcedureTunerAttributeFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Synchro\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsAttribute\s*,\s*(ATTRIBUTE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readSynchroProcedureTunerRaceFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Synchro\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsRace\s*,\s*(RACE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readXyzProcedureAttributeFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Xyz\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsAttribute\s*,\s*(ATTRIBUTE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readXyzProcedureTypeFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Xyz\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsType\s*,\s*(TYPE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readLinkProcedureTypeFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Link\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsType\s*,\s*(TYPE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readLinkProcedureRaceFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Link\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsRace\s*,\s*(RACE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
}

function readLinkProcedureAttributeFilter(source: string | undefined): number | undefined {
  const match = source?.match(/Link\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunctionEx\(\s*Card\.IsAttribute\s*,\s*(ATTRIBUTE_[A-Z0-9_]+)\s*\)/);
  if (!match?.[1]) return undefined;
  return luaNumericConstants[match[1]];
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
