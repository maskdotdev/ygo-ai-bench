import fengari from "fengari";
import { luaArchetypeSetcodeNumericConstants } from "#lua/basic-archetype-setcode-constant-data.js";
import { luaNumericConstants } from "#lua/basic-constant-data.js";
import type { DuelCardInstance } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const ATTRIBUTE_CONSTANT_EXPRESSION = String.raw`ATTRIBUTE_[A-Z0-9_]+(?:\s*\|\s*ATTRIBUTE_[A-Z0-9_]+)*`;
const RACE_CONSTANT_EXPRESSION = String.raw`RACES?_[A-Z0-9_]+(?:\s*\|\s*RACES?_[A-Z0-9_]+)*`;
const SET_CONSTANT_EXPRESSION = String.raw`SET_[A-Z0-9_]+(?:\s*\|\s*SET_[A-Z0-9_]+)*`;
const TYPE_CONSTANT_EXPRESSION = String.raw`TYPE_[A-Z0-9_]+(?:\s*\|\s*TYPE_[A-Z0-9_]+)*`;

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
  const synchroNonTunerAttribute = readSynchroProcedureNonTunerAttributeFilter(source);
  if (synchroNonTunerAttribute !== undefined) card.data.synchroNonTunerAttribute = synchroNonTunerAttribute;
  const synchroTunerRace = readSynchroProcedureTunerRaceFilter(source);
  if (synchroTunerRace !== undefined) card.data.synchroTunerRace = synchroTunerRace;
  const synchroNonTunerRace = readSynchroProcedureNonTunerRaceFilter(source);
  if (synchroNonTunerRace !== undefined) card.data.synchroNonTunerRace = synchroNonTunerRace;
  const synchroTunerType = readSynchroProcedureTunerTypeFilter(source);
  if (synchroTunerType !== undefined) card.data.synchroTunerType = synchroTunerType;
  const synchroNonTunerType = readSynchroProcedureNonTunerTypeFilter(source);
  if (synchroNonTunerType !== undefined) card.data.synchroNonTunerType = synchroNonTunerType;
  const xyzCount = readProcedureNumberField(L, card, "xyz_materials", 3);
  if (xyzCount !== undefined) card.data.xyzMaterialCount = xyzCount;
  const xyzRace = readXyzProcedureRaceFilter(source);
  if (xyzRace !== undefined) card.data.xyzMaterialRace = xyzRace;
  const xyzAttribute = readXyzProcedureAttributeFilter(source);
  if (xyzAttribute !== undefined) card.data.xyzMaterialAttribute = xyzAttribute;
  const xyzType = readXyzProcedureTypeFilter(source);
  if (xyzType !== undefined) card.data.xyzMaterialType = xyzType;
  const xyzSetcode = readXyzProcedureSetcodeFilter(source);
  if (xyzSetcode !== undefined) card.data.xyzMaterialSetcode = xyzSetcode;
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
  return readAddProcedureConstantFilter(source, "Xyz", "Card.IsRace", RACE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureTunerAttributeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Synchro", "Card.IsAttribute", ATTRIBUTE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureNonTunerAttributeFilter(source: string | undefined): number | undefined {
  return readSynchroNonTunerConstantFilter(source, "Card.IsAttribute", ATTRIBUTE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureTunerRaceFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Synchro", "Card.IsRace", RACE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureNonTunerRaceFilter(source: string | undefined): number | undefined {
  return readSynchroNonTunerConstantFilter(source, "Card.IsRace", RACE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureTunerTypeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Synchro", "Card.IsType", TYPE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureNonTunerTypeFilter(source: string | undefined): number | undefined {
  return readSynchroNonTunerConstantFilter(source, "Card.IsType", TYPE_CONSTANT_EXPRESSION);
}

function readXyzProcedureAttributeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Xyz", "Card.IsAttribute", ATTRIBUTE_CONSTANT_EXPRESSION);
}

function readXyzProcedureTypeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Xyz", "Card.IsType", TYPE_CONSTANT_EXPRESSION);
}

function readXyzProcedureSetcodeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Xyz", "Card.IsSetCard", SET_CONSTANT_EXPRESSION);
}

function readLinkProcedureTypeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Link", "Card.IsType", TYPE_CONSTANT_EXPRESSION);
}

function readLinkProcedureRaceFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Link", "Card.IsRace", RACE_CONSTANT_EXPRESSION);
}

function readLinkProcedureAttributeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Link", "Card.IsAttribute", ATTRIBUTE_CONSTANT_EXPRESSION);
}

function readAddProcedureConstantFilter(source: string | undefined, procedure: "Link" | "Synchro" | "Xyz", predicate: string, constantExpression: string): number | undefined {
  const match = source?.match(new RegExp(String.raw`${procedure}\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)`));
  return readLuaConstantExpression(match?.[1]);
}

function readSynchroNonTunerConstantFilter(source: string | undefined, predicate: string, constantExpression: string): number | undefined {
  const match = source?.match(new RegExp(String.raw`Synchro\.NonTunerEx\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)`));
  return readLuaConstantExpression(match?.[1]);
}

function readLuaConstantExpression(expression: string | undefined): number | undefined {
  if (!expression) return undefined;
  let value = 0;
  for (const constant of expression.split("|").map((part) => part.trim())) {
    const numeric = luaNumericConstants[constant] ?? luaArchetypeSetcodeNumericConstants[constant];
    if (numeric === undefined) return undefined;
    value |= numeric;
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
