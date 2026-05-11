import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;

export function knownLuaEffectTargetDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const fixed = knownFixedFunctionDescriptor(L, index, hostState);
  if (fixed !== undefined) return fixed;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const cardParam = luaFunctionParams(snippet)?.[1];
  if (!cardParam) return undefined;
  const card = escapeRegExp(cardParam);
  const notTypeExtra = snippet.match(
    new RegExp(`\\breturn\\s+(?:not\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))`),
  );
  const notTypeExtraToken = notTypeExtra?.[1] ?? notTypeExtra?.[2];
  const notTypeExtraValue = notTypeExtraToken ? luaNumberExpressionValue(L, index, notTypeExtraToken) : undefined;
  if (notTypeExtraValue === 0x40) return "special-summon-limit:non-fusion-extra";
  if (notTypeExtraValue !== undefined) return `special-summon-limit:not-type-extra:${notTypeExtraValue}`;
  const notNamedTypeExtra = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*Is(Fusion|Ritual|Synchro|Xyz|Pendulum|Link)Monster\\s*\\(\\s*\\)`));
  const notNamedTypeExtraValue = notNamedTypeExtra?.[1] ? namedExtraDeckMonsterTypeValue(notNamedTypeExtra[1]) : undefined;
  if (notNamedTypeExtraValue === 0x40) return "special-summon-limit:non-fusion-extra";
  if (notNamedTypeExtraValue !== undefined) return `special-summon-limit:not-type-extra:${notNamedTypeExtraValue}`;
  const notTypeAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\))`));
  const notTypeAttributeExtraTypeToken = notTypeAttributeExtra?.[1] ?? notTypeAttributeExtra?.[4];
  const notTypeAttributeExtraAttributeToken = notTypeAttributeExtra?.[2] ?? notTypeAttributeExtra?.[3];
  const notTypeAttributeExtraType = notTypeAttributeExtraTypeToken ? luaNumberTokenValue(L, index, notTypeAttributeExtraTypeToken) : undefined;
  const notTypeAttributeExtraAttribute = notTypeAttributeExtraAttributeToken ? luaNumberTokenValue(L, index, notTypeAttributeExtraAttributeToken) : undefined;
  if (notTypeAttributeExtraType !== undefined && notTypeAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${notTypeAttributeExtraType}:${notTypeAttributeExtraAttribute}`;
  const notTypeRankExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRank\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRank\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeRankExtraTypeToken = notTypeRankExtra?.[1] ?? notTypeRankExtra?.[3];
  const notTypeRankExtraRankToken = notTypeRankExtra?.[2] ?? notTypeRankExtra?.[4];
  const notTypeRankExtraType = notTypeRankExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeRankExtraTypeToken) : undefined;
  const notTypeRankExtraRank = notTypeRankExtraRankToken ? luaNumberTokenValue(L, index, notTypeRankExtraRankToken) : undefined;
  if (notTypeRankExtraType !== undefined && notTypeRankExtraRank !== undefined) return `special-summon-limit:not-type-rank-extra:${notTypeRankExtraType}:${notTypeRankExtraRank}`;
  const notNamedTypeAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*Is(Fusion|Ritual|Synchro|Xyz|Pendulum|Link)Monster\\s*\\(\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notNamedTypeAttributeExtraType = notNamedTypeAttributeExtra?.[1] ? namedExtraDeckMonsterTypeValue(notNamedTypeAttributeExtra[1]) : undefined;
  const notNamedTypeAttributeExtraAttribute = notNamedTypeAttributeExtra?.[2] ? luaNumberTokenValue(L, index, notNamedTypeAttributeExtra[2]) : undefined;
  if (notNamedTypeAttributeExtraType !== undefined && notNamedTypeAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${notNamedTypeAttributeExtraType}:${notNamedTypeAttributeExtraAttribute}`;
  const notSynchroAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsSynchroMonster\\s*\\(\\s*\\)\\s*\\)`));
  const notSynchroAttributeExtraAttribute = notSynchroAttributeExtra?.[1] ? luaNumberTokenValue(L, index, notSynchroAttributeExtra[1]) : undefined;
  if (notSynchroAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${0x2000}:${notSynchroAttributeExtraAttribute}`;
  const notTypeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeRaceExtraType = notTypeRaceExtra?.[1] ?? notTypeRaceExtra?.[3];
  const notTypeRaceExtraRace = notTypeRaceExtra?.[2] ?? notTypeRaceExtra?.[4] ?? notTypeRaceExtra?.[5];
  const notTypeRaceExtraTypeToken = notTypeRaceExtraType ?? notTypeRaceExtra?.[6];
  const notTypeRaceExtraTypeValue = notTypeRaceExtraTypeToken ? luaNumberTokenValue(L, index, notTypeRaceExtraTypeToken) : undefined;
  const notTypeRaceExtraRaceValue = notTypeRaceExtraRace ? luaNumberTokenValue(L, index, notTypeRaceExtraRace) : undefined;
  if (notTypeRaceExtraTypeValue !== undefined && notTypeRaceExtraRaceValue !== undefined) return `special-summon-limit:not-type-race-extra:${notTypeRaceExtraTypeValue}:${notTypeRaceExtraRaceValue}`;
  const notTypeAttributeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notTypeAttributeRaceExtraType = notTypeAttributeRaceExtra?.[1] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[1]) : undefined;
  const notTypeAttributeRaceExtraAttribute = notTypeAttributeRaceExtra?.[2] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[2]) : undefined;
  const notTypeAttributeRaceExtraRace = notTypeAttributeRaceExtra?.[3] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[3]) : undefined;
  if (notTypeAttributeRaceExtraType !== undefined && notTypeAttributeRaceExtraAttribute !== undefined && notTypeAttributeRaceExtraRace !== undefined) return `special-summon-limit:not-type-attribute-race-extra:${notTypeAttributeRaceExtraType}:${notTypeAttributeRaceExtraAttribute}:${notTypeAttributeRaceExtraRace}`;
  const notTypeRaceAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notTypeRaceAttributeExtraType = notTypeRaceAttributeExtra?.[1] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[1]) : undefined;
  const notTypeRaceAttributeExtraRace = notTypeRaceAttributeExtra?.[2] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[2]) : undefined;
  const notTypeRaceAttributeExtraAttribute = notTypeRaceAttributeExtra?.[3] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[3]) : undefined;
  if (notTypeRaceAttributeExtraType !== undefined && notTypeRaceAttributeExtraAttribute !== undefined && notTypeRaceAttributeExtraRace !== undefined) return `special-summon-limit:not-type-attribute-race-extra:${notTypeRaceAttributeExtraType}:${notTypeRaceAttributeExtraAttribute}:${notTypeRaceAttributeExtraRace}`;
  const notAttributeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notAttributeRaceExtraAttribute = notAttributeRaceExtra?.[1] ? luaNumberTokenValue(L, index, notAttributeRaceExtra[1]) : undefined;
  const notAttributeRaceExtraRace = notAttributeRaceExtra?.[2] ? luaNumberTokenValue(L, index, notAttributeRaceExtra[2]) : undefined;
  if (notAttributeRaceExtraAttribute !== undefined && notAttributeRaceExtraRace !== undefined) return `special-summon-limit:not-attribute-race-extra:${notAttributeRaceExtraAttribute}:${notAttributeRaceExtraRace}`;
  const notType = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*Is(?:Original)?Type\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const notTypeValue = notType?.[1] ? luaNumberTokenValue(L, index, notType[1]) : undefined;
  if (notTypeValue !== undefined) return `target:not-type:${notTypeValue}`;
  const notRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)|not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notRaceExtraToken = notRaceExtra?.[1] ?? notRaceExtra?.[2];
  const notRaceExtraValue = notRaceExtraToken ? luaNumberTokenValue(L, index, notRaceExtraToken) : undefined;
  if (notRaceExtraValue !== undefined) return `special-summon-limit:not-race-extra:${notRaceExtraValue}`;
  const notAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)|not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notAttributeExtraToken = notAttributeExtra?.[1] ?? notAttributeExtra?.[2];
  const notAttributeExtraValue = notAttributeExtraToken ? luaNumberTokenValue(L, index, notAttributeExtraToken) : undefined;
  if (notAttributeExtraValue !== undefined) return `special-summon-limit:not-attribute-extra:${notAttributeExtraValue}`;
  const notAttribute = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) ?? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*GetAttribute\\s*\\(\\s*\\)\\s*~=\\s*(${numericOrIdentifierPattern})`));
  const notAttributeValue = notAttribute?.[1] ? luaNumberTokenValue(L, index, notAttribute[1]) : undefined;
  if (notAttributeValue !== undefined) return `target:not-attribute:${notAttributeValue}`;
  const notRace = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) ?? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*GetRace\\s*\\(\\s*\\)\\s*~=\\s*(${numericOrIdentifierPattern})`));
  const notRaceValue = notRace?.[1] ? luaNumberTokenValue(L, index, notRace[1]) : undefined;
  if (notRaceValue !== undefined) return `target:not-race:${notRaceValue}`;
  const setcodeOrCodeType = setcodeOrCodeTypeTargetDescriptor(L, index, snippet, card);
  if (setcodeOrCodeType !== undefined) return setcodeOrCodeType;
  const effectParam = luaFunctionParams(snippet)?.[0];
  if (effectParam && new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsCode\\s*\\(\\s*${escapeRegExp(effectParam)}\\s*:\\s*GetLabel\\s*\\(\\s*\\)\\s*\\)`).test(snippet)) return "target:same-code-label";
  const summonTypeParam = luaFunctionParams(snippet)?.[3];
  if (summonTypeParam) {
    const summonTypeNot = snippet.match(new RegExp(`\\breturn\\s+${escapeRegExp(summonTypeParam)}\\s*~=\\s*(SUMMON_TYPE_SPECIAL\\s*\\+\\s*${numericOrIdentifierPattern}|${numericOrIdentifierPattern})`));
    const value = summonTypeNot?.[1] ? luaSummonTypeTokenValue(L, index, summonTypeNot[1]) : undefined;
    if (value !== undefined) return `target:special-summon-type-not:${value}`;
  }
  const notSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const setcode = notSetcode?.[1] ? luaNumberTokenValue(L, index, notSetcode[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? `target:not-setcode:${setcode}` : undefined;
}

export function specialSummonTypeNotTargetDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:special-summon-type-not:")) return undefined;
  const value = Number(descriptor.slice("target:special-summon-type-not:".length));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function knownFixedFunctionDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (const [ref, descriptor] of hostState.functionDescriptors) {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    const matches = Boolean(lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1));
    lua.lua_pop(L, 1);
    if (matches) return descriptor;
  }
  return undefined;
}

const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;
const numericOrIdentifierExpressionPattern = String.raw`${numericOrIdentifierPattern}(?:\s*[|+]\s*${numericOrIdentifierPattern})*`;

function setcodeOrCodeTypeTargetDescriptor(L: unknown, index: number, snippet: string, card: string): string | undefined {
  const cardCall = `${card}\\s*:\\s*`;
  const setcodeCall = `${cardCall}IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const codeCall = `${cardCall}IsCode\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const typeCall = `${cardCall}IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const match =
    snippet.match(new RegExp(`\\breturn\\s+${setcodeCall}\\s+or\\s+\\(?\\s*${codeCall}\\s+and\\s+${typeCall}\\s*\\)?`)) ??
    snippet.match(new RegExp(`\\breturn\\s+${setcodeCall}\\s+or\\s+\\(?\\s*${typeCall}\\s+and\\s+${codeCall}\\s*\\)?`));
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const setcode = luaNumberTokenValue(L, index, match[1]);
  const code = luaNumberTokenValue(L, index, match[2]);
  const type = luaNumberTokenValue(L, index, match[3]);
  return setcode !== undefined && code !== undefined && type !== undefined ? `target:setcode-or-code-type:${setcode}:${code}:${type}` : undefined;
}

function luaNumberTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  if (/^0x[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[A-Za-z_]\w*$/.test(token)) return undefined;
  lua.lua_getglobal(L, to_luastring(token));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value ?? luaNumberUpvalueValue(L, functionIndex, token);
}

function luaNumberExpressionValue(L: unknown, functionIndex: number, token: string): number | undefined {
  const parts = token.split(/[|+]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  let value = 0;
  for (const part of parts) {
    const partValue = luaNumberTokenValue(L, functionIndex, part);
    if (partValue === undefined) return undefined;
    value |= partValue;
  }
  return value;
}

function namedExtraDeckMonsterTypeValue(name: string): number | undefined {
  if (name === "Fusion") return 0x40;
  if (name === "Ritual") return 0x80;
  if (name === "Synchro") return 0x2000;
  if (name === "Xyz") return 0x800000;
  if (name === "Pendulum") return 0x1000000;
  if (name === "Link") return 0x4000000;
  return undefined;
}

function luaSummonTypeTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  const parts = token.split("+").map((part) => part.trim());
  if (parts.length === 2 && parts[0] === "SUMMON_TYPE_SPECIAL" && parts[1] !== undefined) {
    const detail = luaNumberTokenValue(L, functionIndex, parts[1]);
    return detail === undefined ? undefined : 0x40000000 + detail;
  }
  return luaNumberTokenValue(L, functionIndex, token);
}

function luaNumberUpvalueValue(L: unknown, index: number, token: string): number | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return undefined;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    const value = name === token && lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
    lua.lua_pop(L, 1);
    if (value !== undefined) return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
