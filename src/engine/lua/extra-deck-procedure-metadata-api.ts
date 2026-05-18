import fengari from "fengari";
import { luaArchetypeSetcodeNumericConstants } from "#lua/basic-archetype-setcode-constant-data.js";
import { luaCardCounterNumericConstants } from "#lua/basic-card-counter-constant-data.js";
import { luaNumericConstants } from "#lua/basic-constant-data.js";
import type { DuelCardInstance, FusionMaterialPredicateRequirement } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const ATTRIBUTE_CONSTANT_EXPRESSION = String.raw`ATTRIBUTE_[A-Z0-9_]+(?:\s*\|\s*ATTRIBUTE_[A-Z0-9_]+)*`;
const RACE_CONSTANT_EXPRESSION = String.raw`RACES?_[A-Z0-9_]+(?:\s*\|\s*RACES?_[A-Z0-9_]+)*`;
const SET_CONSTANT_EXPRESSION = String.raw`SET_[A-Z0-9_]+(?:\s*\|\s*SET_[A-Z0-9_]+)*`;
const SUMMON_TYPE_CONSTANT_EXPRESSION = String.raw`SUMMON_TYPE_[A-Z0-9_]+(?:\s*\|\s*SUMMON_TYPE_[A-Z0-9_]+)*`;
const TYPE_CONSTANT_EXPRESSION = String.raw`TYPE_[A-Z0-9_]+(?:\s*\|\s*TYPE_[A-Z0-9_]+)*`;
const LOCATION_CONSTANT_EXPRESSION = String.raw`LOCATION_[A-Z0-9_]+(?:\s*\|\s*LOCATION_[A-Z0-9_]+)*`;
const CARD_CODE_EXPRESSION = String.raw`(?:\d+|CARD_[A-Z0-9_]+)`;
const XYZ_INFINITE_MATERIAL_MAX = 99;

export function applyLuaExtraDeckProcedureMetadata(L: unknown, card: DuelCardInstance, source?: string): void {
  const fusionMaterials = readFusionAddProcMixMaterials(L, card, source);
  if (fusionMaterials.length > 0) card.data.fusionMaterials = fusionMaterials;
  const fusionRequiredPredicates = readFusionAddProcMixPredicateMaterials(source);
  if (fusionRequiredPredicates.length > 0) card.data.fusionRequiredMaterialPredicates = fusionRequiredPredicates;
  const fusionRepeatedMaterials = readFusionAddProcMixRepMaterials(source) ?? readFusionAddProcMixNRepeatedMaterials(source);
  if (fusionRepeatedMaterials) {
    card.data.fusionMaterialMin = fusionRepeatedMaterials.min;
    card.data.fusionMaterialMax = fusionRepeatedMaterials.max;
    if (fusionRepeatedMaterials.race !== undefined) card.data.fusionMaterialRace = fusionRepeatedMaterials.race;
    if (fusionRepeatedMaterials.type !== undefined) card.data.fusionMaterialType = fusionRepeatedMaterials.type;
    if (fusionRepeatedMaterials.setcode !== undefined) card.data.fusionMaterialSetcode = fusionRepeatedMaterials.setcode;
    if (fusionRepeatedMaterials.location !== undefined) card.data.fusionMaterialLocation = fusionRepeatedMaterials.location;
    if (fusionRepeatedMaterials.extraCodes.length > 0) card.data.fusionMaterials = fusionRepeatedMaterials.extraCodes.map(String);
    if (fusionRepeatedMaterials.extraSetcodes.length > 0) card.data.fusionRequiredMaterialSetcodes = fusionRepeatedMaterials.extraSetcodes;
  }
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
  const synchroTunerLevel = readSynchroProcedureTunerLevelFilter(source);
  if (synchroTunerLevel !== undefined) card.data.synchroTunerLevel = synchroTunerLevel;
  const synchroTunerRace = readSynchroProcedureTunerRaceFilter(source);
  if (synchroTunerRace !== undefined) card.data.synchroTunerRace = synchroTunerRace;
  const synchroNonTunerRace = readSynchroProcedureNonTunerRaceFilter(source);
  if (synchroNonTunerRace !== undefined) card.data.synchroNonTunerRace = synchroNonTunerRace;
  const synchroTunerType = readSynchroProcedureTunerTypeFilter(source);
  if (synchroTunerType !== undefined) card.data.synchroTunerType = synchroTunerType;
  const synchroTunerSetcode = readSynchroProcedureTunerSetcodeFilter(source);
  if (synchroTunerSetcode !== undefined) card.data.synchroTunerSetcode = synchroTunerSetcode;
  const synchroNonTunerType = readSynchroProcedureNonTunerTypeFilter(source);
  if (synchroNonTunerType !== undefined) card.data.synchroNonTunerType = synchroNonTunerType;
  const synchroNonTunerSetcode = readSynchroProcedureNonTunerSetcodeFilter(source);
  if (synchroNonTunerSetcode !== undefined) card.data.synchroNonTunerSetcode = synchroNonTunerSetcode;
  const xyzCount = readProcedureNumberField(L, card, "xyz_materials", 3);
  if (xyzCount !== undefined) card.data.xyzMaterialCount = xyzCount;
  const xyzMax = readProcedureNumberField(L, card, "xyz_materials", 6) ?? readXyzProcedureInfiniteMaterialMax(source);
  if (xyzMax !== undefined) card.data.xyzMaterialMax = xyzMax;
  const xyzRace = readXyzProcedureRaceFilter(source);
  if (xyzRace !== undefined) card.data.xyzMaterialRace = xyzRace;
  const xyzAttribute = readXyzProcedureAttributeFilter(source);
  if (xyzAttribute !== undefined) card.data.xyzMaterialAttribute = xyzAttribute;
  const xyzType = readXyzProcedureTypeFilter(source);
  if (xyzType !== undefined) card.data.xyzMaterialType = xyzType;
  const xyzSetcode = readXyzProcedureSetcodeFilter(source);
  if (xyzSetcode !== undefined) card.data.xyzMaterialSetcode = xyzSetcode;
  const xyzRank = readXyzProcedureRankFilter(source);
  if (xyzRank !== undefined) card.data.xyzMaterialRank = xyzRank;
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
  const linkSetcode = readLinkProcedureSetcodeFilter(source);
  if (linkSetcode !== undefined) card.data.linkMaterialSetcode = linkSetcode;
  const linkSummonType = readLinkProcedureSummonTypeFilter(source);
  if (linkSummonType !== undefined) card.data.linkMaterialSummonType = linkSummonType;
  const linkLevel = readLinkProcedureLevelFilter(source);
  if (linkLevel !== undefined) card.data.linkMaterialLevel = linkLevel;
  const linkMinLevel = readLinkProcedureMinLevelFilter(source);
  if (linkMinLevel !== undefined) card.data.linkMaterialMinLevel = linkMinLevel;
}

function readFusionAddProcMixMaterials(L: unknown, card: DuelCardInstance, source: string | undefined): string[] {
  if (!source) return [];
  if (/\bFusion\.AddProcMixN\(/.test(source)) return readFusionAddProcMixNMaterials(L, card);
  if (!/\bFusion\.AddProc(?:Mix|Code[234]|CodeRep)\(/.test(source)) return [];
  const values = readProcedureNumberListField(L, card, "fusion_materials", 3);
  const exactMaterials = readFusionAddProcMixExactMaterials(source);
  const materials = [...values, ...exactMaterials.filter((code) => !values.includes(code))].map(String);
  return materials.length >= (exactMaterials.length > 0 ? 1 : 2) ? materials : [];
}

function readFusionAddProcMixExactMaterials(source: string | undefined): number[] {
  const match = source?.match(/Fusion\.AddProcMix\(\s*c\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,([^\n]*)\)/);
  if (!match?.[1]) return [];
  return readLuaCodeList(match[1].replace(/aux\.FilterBoolFunction(?:Ex)?\([^)]*\)/g, ""));
}

function readFusionAddProcMixNMaterials(L: unknown, card: DuelCardInstance): string[] {
  const values = readProcedureNumberListField(L, card, "fusion_materials", 3);
  if (values.length < 2 || values.length % 2 !== 0) return [];
  const materials: string[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const code = values[index]!;
    const count = values[index + 1]!;
    if (count <= 0) return [];
    for (let copy = 0; copy < count; copy += 1) materials.push(String(code));
  }
  return materials.length >= 2 ? materials : [];
}

function readFusionAddProcMixPredicateMaterials(source: string | undefined): FusionMaterialPredicateRequirement[] {
  const match = source?.match(/Fusion\.AddProcMix\(\s*c\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,([^\n]*)\)/);
  if (!match?.[1]) return [];
  const predicates: FusionMaterialPredicateRequirement[] = [];
  for (const [, predicate, expression] of match[1].matchAll(/aux\.FilterBoolFunction(?:Ex)?\(\s*(Card\.Is(?:AttackAbove|AttackBelow|LevelAbove|LevelBelow|Attribute|Location|Race|SetCard|Type))\s*,\s*(\d+|[A-Z0-9_]+(?:\s*\|\s*[A-Z0-9_]+)*)\s*\)/g)) {
    if (!predicate || !expression) continue;
    if (predicate === "Card.IsAttackBelow" || predicate === "Card.IsAttackAbove" || predicate === "Card.IsLevelBelow" || predicate === "Card.IsLevelAbove") {
      const value = Number.parseInt(expression, 10);
      if (value <= 0) continue;
      if (predicate === "Card.IsAttackBelow") predicates.push({ attackMax: value });
      if (predicate === "Card.IsAttackAbove") predicates.push({ attackMin: value });
      if (predicate === "Card.IsLevelBelow") predicates.push({ levelMax: value });
      if (predicate === "Card.IsLevelAbove") predicates.push({ levelMin: value });
      continue;
    }
    const value = readLuaConstantExpression(expression);
    if (value === undefined) continue;
    if (predicate === "Card.IsAttribute") predicates.push({ attribute: value });
    if (predicate === "Card.IsLocation") predicates.push({ location: value });
    if (predicate === "Card.IsRace") predicates.push({ race: value });
    if (predicate === "Card.IsSetCard") predicates.push({ setcode: value });
    if (predicate === "Card.IsType") predicates.push({ type: value });
  }
  return predicates;
}

function readFusionAddProcMixRepMaterials(source: string | undefined): { min: number; max: number; extraCodes: number[]; extraSetcodes: number[]; race?: number; type?: number; setcode?: number; location?: number } | undefined {
  return readFusionAddProcMixRepConstantFilter(source, "Card.IsRace", RACE_CONSTANT_EXPRESSION, "race")
    ?? readFusionAddProcMixRepConstantFilter(source, "Card.IsType", TYPE_CONSTANT_EXPRESSION, "type")
    ?? readFusionAddProcMixRepConstantFilter(source, "Card.IsSetCard", SET_CONSTANT_EXPRESSION, "setcode")
    ?? readFusionAddProcMixRepConstantFilter(source, "Card.IsLocation", LOCATION_CONSTANT_EXPRESSION, "location");
}

function readFusionAddProcMixNRepeatedMaterials(source: string | undefined): { min: number; max: number; extraCodes: number[]; extraSetcodes: number[]; race?: number; type?: number; setcode?: number; location?: number } | undefined {
  return readFusionAddProcMixNRepeatedMixedConstantFilter(source, "Card.IsRace", RACE_CONSTANT_EXPRESSION, "race")
    ?? readFusionAddProcMixNRepeatedMixedConstantFilter(source, "Card.IsType", TYPE_CONSTANT_EXPRESSION, "type")
    ?? readFusionAddProcMixNRepeatedMixedConstantFilter(source, "Card.IsSetCard", SET_CONSTANT_EXPRESSION, "setcode")
    ?? readFusionAddProcMixNRepeatedMixedConstantFilter(source, "Card.IsLocation", LOCATION_CONSTANT_EXPRESSION, "location")
    ?? readFusionAddProcMixNRepeatedConstantFilter(source, "Card.IsRace", RACE_CONSTANT_EXPRESSION, "race")
    ?? readFusionAddProcMixNRepeatedConstantFilter(source, "Card.IsType", TYPE_CONSTANT_EXPRESSION, "type")
    ?? readFusionAddProcMixNRepeatedConstantFilter(source, "Card.IsSetCard", SET_CONSTANT_EXPRESSION, "setcode")
    ?? readFusionAddProcMixNRepeatedConstantFilter(source, "Card.IsLocation", LOCATION_CONSTANT_EXPRESSION, "location");
}

function readFusionAddProcMixNRepeatedMixedConstantFilter<K extends "race" | "type" | "setcode" | "location">(
  source: string | undefined,
  predicate: string,
  constantExpression: string,
  key: K,
): ({ min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>) | undefined {
  const match = source?.match(new RegExp(String.raw`Fusion\.AddProcMixN\(\s*c\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*(${CARD_CODE_EXPRESSION}|aux\.FilterBoolFunction(?:Ex)?\(\s*Card\.IsSetCard\s*,\s*${SET_CONSTANT_EXPRESSION}\s*\))\s*,\s*(\d+)\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)\s*,\s*(\d+)\s*\)`));
  const required = match?.[1];
  const requiredCount = match?.[2] === undefined ? undefined : Number.parseInt(match[2], 10);
  const value = readLuaConstantExpression(match?.[3]);
  const count = match?.[4] === undefined ? undefined : Number.parseInt(match[4], 10);
  if (!required || requiredCount === undefined || value === undefined || count === undefined || requiredCount <= 0 || count <= 0) return undefined;
  const requiredCode = readLuaCodeList(`,${required}`).at(0);
  const requiredSetcode = readLuaSetcodeFilterList(required).at(0);
  if (requiredCode === undefined && requiredSetcode === undefined) return undefined;
  return {
    min: count,
    max: count,
    extraCodes: requiredCode === undefined ? [] : Array.from({ length: requiredCount }, () => requiredCode),
    extraSetcodes: requiredSetcode === undefined ? [] : Array.from({ length: requiredCount }, () => requiredSetcode),
    [key]: value,
  } as unknown as { min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>;
}

function readFusionAddProcMixNRepeatedConstantFilter<K extends "race" | "type" | "setcode" | "location">(
  source: string | undefined,
  predicate: string,
  constantExpression: string,
  key: K,
): ({ min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>) | undefined {
  const match = source?.match(new RegExp(String.raw`Fusion\.AddProcMixN\(\s*c\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)\s*,\s*(\d+)\s*\)`));
  const value = readLuaConstantExpression(match?.[1]);
  const count = match?.[2] === undefined ? undefined : Number.parseInt(match[2], 10);
  if (value === undefined || count === undefined || count <= 0) return undefined;
  return { min: count, max: count, extraCodes: [], extraSetcodes: [], [key]: value } as unknown as { min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>;
}

function readFusionAddProcMixRepConstantFilter<K extends "race" | "type" | "setcode" | "location">(
  source: string | undefined,
  predicate: string,
  constantExpression: string,
  key: K,
): ({ min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>) | undefined {
  const match = source?.match(new RegExp(String.raw`Fusion\.AddProcMixRep\(\s*c\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)\s*,\s*(\d+)\s*,\s*(\d+)([^\n]*)\)`));
  const value = readLuaConstantExpression(match?.[1]);
  const min = match?.[2] === undefined ? undefined : Number.parseInt(match[2], 10);
  const max = match?.[3] === undefined ? undefined : Number.parseInt(match[3], 10);
  const extraCodes = readLuaCodeList(match?.[4]);
  const extraSetcodes = readLuaSetcodeFilterList(match?.[4]);
  if (value === undefined || min === undefined || max === undefined || min <= 0 || max < min) return undefined;
  return { min, max, extraCodes, extraSetcodes, [key]: value } as { min: number; max: number; extraCodes: number[]; extraSetcodes: number[] } & Record<K, number>;
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

function readSynchroProcedureTunerLevelFilter(source: string | undefined): number | undefined {
  return readAddProcedureNumberFilter(source, "Synchro", "Card.IsLevel");
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

function readSynchroProcedureTunerSetcodeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Synchro", "Card.IsSetCard", SET_CONSTANT_EXPRESSION);
}

function readSynchroProcedureNonTunerTypeFilter(source: string | undefined): number | undefined {
  return readSynchroNonTunerConstantFilter(source, "Card.IsType", TYPE_CONSTANT_EXPRESSION);
}

function readSynchroProcedureNonTunerSetcodeFilter(source: string | undefined): number | undefined {
  return readSynchroNonTunerConstantFilter(source, "Card.IsSetCard", SET_CONSTANT_EXPRESSION);
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

function readXyzProcedureRankFilter(source: string | undefined): number | undefined {
  return readAddProcedureNumberFilter(source, "Xyz", "Card.IsRank");
}

function readXyzProcedureInfiniteMaterialMax(source: string | undefined): number | undefined {
  return source && /Xyz\.AddProcedure\([^\n]*Xyz\.InfiniteMats/.test(source) ? XYZ_INFINITE_MATERIAL_MAX : undefined;
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

function readLinkProcedureSetcodeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Link", "Card.IsSetCard", SET_CONSTANT_EXPRESSION);
}

function readLinkProcedureSummonTypeFilter(source: string | undefined): number | undefined {
  return readAddProcedureConstantFilter(source, "Link", "Card.IsSummonType", SUMMON_TYPE_CONSTANT_EXPRESSION);
}

function readLinkProcedureLevelFilter(source: string | undefined): number | undefined {
  return readAddProcedureNumberFilter(source, "Link", "Card.IsLevel");
}

function readLinkProcedureMinLevelFilter(source: string | undefined): number | undefined {
  return readAddProcedureNumberFilter(source, "Link", "Card.IsLevelAbove");
}

function readAddProcedureConstantFilter(source: string | undefined, procedure: "Link" | "Synchro" | "Xyz", predicate: string, constantExpression: string): number | undefined {
  const match = source?.match(new RegExp(String.raw`${procedure}\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)`));
  return readLuaConstantExpression(match?.[1]);
}

function readAddProcedureNumberFilter(source: string | undefined, procedure: "Link" | "Synchro" | "Xyz", predicate: string): number | undefined {
  const match = source?.match(new RegExp(String.raw`${procedure}\.AddProcedure\(\s*c\s*,\s*aux\.FilterBoolFunction(?:Ex)?\(\s*${escapeRegExp(predicate)}\s*,\s*(\d+)\s*\)`));
  const value = match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
  return value !== undefined && value > 0 ? value : undefined;
}

function readSynchroNonTunerConstantFilter(source: string | undefined, predicate: string, constantExpression: string): number | undefined {
  const match = source?.match(new RegExp(String.raw`Synchro\.NonTunerEx\(\s*${escapeRegExp(predicate)}\s*,\s*(${constantExpression})\s*\)`));
  return readLuaConstantExpression(match?.[1]);
}

function readLuaConstantExpression(expression: string | undefined): number | undefined {
  if (!expression) return undefined;
  let value = 0;
  for (const constant of expression.split("|").map((part) => part.trim())) {
    const numeric = luaNumericConstants[constant] ?? luaArchetypeSetcodeNumericConstants[constant] ?? luaCardCounterNumericConstants[constant];
    if (numeric === undefined) return undefined;
    value |= numeric;
  }
  return value;
}

function readLuaCodeList(source: string | undefined): number[] {
  if (!source) return [];
  const codes: number[] = [];
  for (const [, rawCode] of source.matchAll(new RegExp(String.raw`(?:^|,)\s*(${CARD_CODE_EXPRESSION})(?=\s*(?:,|$))`, "g"))) {
    if (!rawCode) return [];
    const code = /^\d+$/.test(rawCode) ? Number.parseInt(rawCode, 10) : luaCardCounterNumericConstants[rawCode];
    if (code === undefined || code <= 0) return [];
    codes.push(code);
  }
  return codes;
}

function readLuaSetcodeFilterList(source: string | undefined): number[] {
  if (!source) return [];
  return [...source.matchAll(new RegExp(String.raw`aux\.FilterBoolFunction(?:Ex)?\(\s*Card\.IsSetCard\s*,\s*(${SET_CONSTANT_EXPRESSION})\s*\)`, "g"))]
    .map((match) => readLuaConstantExpression(match[1]))
    .filter((value): value is number => value !== undefined);
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

function readProcedureNumberListField(L: unknown, card: DuelCardInstance, fieldName: string, startIndex: number): number[] {
  lua.lua_getglobal(L, to_luastring(`c${card.code}`));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return [];
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 2);
    return [];
  }
  const values: number[] = [];
  for (let index = startIndex; ; index += 1) {
    lua.lua_rawgeti(L, -1, index);
    const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
    lua.lua_pop(L, 1);
    if (value === undefined || value <= 0) break;
    values.push(value);
  }
  lua.lua_pop(L, 2);
  return values;
}
