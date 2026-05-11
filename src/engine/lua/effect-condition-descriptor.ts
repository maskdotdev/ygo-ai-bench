import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;
const summonTypeConditionValues: Record<string, number> = { Ritual: 0x45000000, Fusion: 0x43000000, Synchro: 0x46000000, Xyz: 0x49000000, Pendulum: 0x4a000000, Link: 0x4c000000 };

export function knownLuaEffectConditionDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  if (/\breturn\s+Duel\s*\.\s*GetCurrentPhase\s*\(\s*\)\s*~=\s*PHASE_DRAW\b/.test(snippet)) return "condition:not-draw-phase";
  const equippedTargetSetcode = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetSetcodeValue = equippedTargetSetcode?.[1] ? luaNumberTokenValue(L, index, equippedTargetSetcode[1]) : undefined;
  if (equippedTargetSetcodeValue !== undefined) return `condition:equipped-target-setcode:${equippedTargetSetcodeValue}`;
  const equippedTargetType = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetTypeValue = equippedTargetType?.[1] ? luaNumberTokenValue(L, index, equippedTargetType[1]) : undefined;
  if (equippedTargetTypeValue !== undefined) return `condition:equipped-target-type:${equippedTargetTypeValue}`;
  const equippedTargetRace = snippet.match(new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s+return\\s+\\1\\s+and\\s+\\1\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetRaceValue = equippedTargetRace?.[2] ? luaNumberTokenValue(L, index, equippedTargetRace[2]) : undefined;
  if (equippedTargetRaceValue !== undefined) return `condition:equipped-target-race:${equippedTargetRaceValue}`;
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetEquipTarget\s*\(\s*\)/.test(snippet)) return "condition:source-equipped";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsFaceup\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-faceup";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsAttackPos\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-attack-position";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsDefensePos\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-defense-position";
  const sourceSummonType = snippet.match(/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*Is(Ritual|Fusion|Synchro|Xyz|Pendulum|Link)Summoned\s*\(\s*\)\s*(?:end\b|$)/);
  if (sourceSummonType?.[1]) return `condition:source-summon-type:${summonTypeConditionValues[sourceSummonType[1]]}`;
  const sourceSummonLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSummonLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceSummonLocationValue = sourceSummonLocation?.[1] ? luaNumberExpressionValue(L, index, sourceSummonLocation[1]) : undefined;
  if (sourceSummonLocationValue !== undefined) return `condition:source-summon-location:${sourceSummonLocationValue}`;
  const sourcePreviousLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourcePreviousLocationValue = sourcePreviousLocation?.[1] ? luaNumberExpressionValue(L, index, sourcePreviousLocation[1]) : undefined;
  if (sourcePreviousLocationValue !== undefined) return `condition:source-previous-location:${sourcePreviousLocationValue}`;
  const sourcePreviousPosition = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousPosition\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourcePreviousPositionValue = sourcePreviousPosition?.[1] ? luaNumberExpressionValue(L, index, sourcePreviousPosition[1]) : undefined;
  if (sourcePreviousPositionValue !== undefined) return `condition:source-previous-position:${sourcePreviousPositionValue}`;
  const sourceOverlayCount = snippet.match(/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetOverlayCount\s*\(\s*\)\s*(==|~=|>|>=)\s*0\s*(?:end\b|$)/);
  if (sourceOverlayCount?.[1]) return sourceOverlayCount[1] === "==" ? "condition:source-overlay-count-zero" : "condition:source-overlay-count-positive";
  const params = luaFunctionParams(snippet);
  if (params && params.length > 0) return undefined;
  const identifier = String.raw`[A-Za-z_]\w*`;
  const sourceController = new RegExp(String.raw`\breturn\s+${identifier}\s*:\s*IsControler\s*\(\s*${identifier}\s*\)\s*(?:end\b|$)`);
  return sourceController.test(snippet) ? "condition:source-controller" : undefined;
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
