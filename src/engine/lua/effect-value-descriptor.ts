import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

export function knownLuaEffectValueDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  if (isNamedTableFunction(L, index, "aux", "tgoval")) return "cannot-be-effect-target:opponent";
  if (isNamedTableFunction(L, index, "aux", "indoval")) return "indestructible:opponent";
  if (isNamedTableFunction(L, index, "aux", "indsval")) return "indestructible:self";
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const reasonMaskPredicate = reasonMaskPredicateDescriptor(snippet, params);
  if (reasonMaskPredicate) return reasonMaskPredicate;
  const valueCardPredicate = valueCardPredicateDescriptor(snippet, params);
  if (valueCardPredicate) return valueCardPredicate;
  const specialSummonedMonsterActivationPredicate = specialSummonedMonsterActivationPredicateDescriptor(snippet, params);
  if (specialSummonedMonsterActivationPredicate) return specialSummonedMonsterActivationPredicate;
  const nonSpiritMonsterActivationPredicate = nonSpiritMonsterActivationPredicateDescriptor(snippet, params);
  if (nonSpiritMonsterActivationPredicate) return nonSpiritMonsterActivationPredicate;
  const spellTrapActivationPredicate = spellTrapActivationPredicateDescriptor(snippet, params);
  if (spellTrapActivationPredicate) return spellTrapActivationPredicate;
  const typedCardActivationPredicate = typedCardActivationPredicateDescriptor(snippet, params);
  if (typedCardActivationPredicate) return typedCardActivationPredicate;
  const cardActivationPredicate = cardActivationPredicateDescriptor(snippet, params);
  if (cardActivationPredicate) return cardActivationPredicate;
  const sameCodeActivationPredicate = sameCodeActivationPredicateDescriptor(snippet, params);
  if (sameCodeActivationPredicate) return sameCodeActivationPredicate;
  const monsterAttributeExceptActivationPredicate = monsterAttributeExceptActivationPredicateDescriptor(L, index, snippet, params);
  if (monsterAttributeExceptActivationPredicate) return monsterAttributeExceptActivationPredicate;
  const materialTargetPredicate = materialTargetPredicateDescriptor(L, index, snippet, params);
  if (materialTargetPredicate) return materialTargetPredicate;
  const effectParam = params?.[0];
  const reasonPlayerParam = params?.[2];
  if (effectParam && reasonPlayerParam) {
    const effect = escapeRegExp(effectParam);
    const reasonPlayer = escapeRegExp(reasonPlayerParam);
    const opponentTargeting = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*~=\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (opponentTargeting.test(snippet)) return "cannot-be-effect-target:opponent";
    const opponentIndestructible = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*==\\s*1\\s*-\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (opponentIndestructible.test(snippet)) return "indestructible:opponent";
    const selfIndestructible = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*==\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (selfIndestructible.test(snippet)) return "indestructible:self";
  }
  const amountParam = params?.[2];
  const reasonParam = params?.[3];
  if (!amountParam || !reasonParam) return undefined;
  const amount = escapeRegExp(amountParam);
  const reason = escapeRegExp(reasonParam);
  const effectReason = "(?:REASON_EFFECT|64)";
  const doubleEffectDamage = new RegExp(`\\breturn\\s+${reason}\\s*&\\s*${effectReason}\\s*>\\s*0\\s+and\\s+${amount}\\s*\\*\\s*2\\s+or\\s+${amount}\\b`);
  if (doubleEffectDamage.test(snippet)) return "change-damage:effect-double";
  const zeroEffectDamage = new RegExp(`\\bif\\s+\\(?\\s*${reason}\\s*&\\s*${effectReason}\\s*\\)?\\s*(?:~=|>)\\s*0\\s+then\\s+return\\s+0\\s+else\\s+return\\s+${amount}\\s+end\\b`);
  if (params?.[5] && zeroEffectDamage.test(snippet)) return "change-damage:effect-zero";
  const relatedEffectParam = params?.[1];
  const reflectedReasonPlayerParam = params?.[4];
  if (!effectParam || !relatedEffectParam || !reflectedReasonPlayerParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const reasonPlayer = escapeRegExp(reflectedReasonPlayerParam);
  const continuousType = "(?:EFFECT_TYPE_CONTINUOUS|2048)";
  const reflectOpponentNonContinuous = new RegExp(
    `\\breturn\\s+${relatedEffect}\\s+and\\s+not\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${continuousType}\\s*\\)\\s+and\\s+${reasonPlayer}\\s*==\\s*1\\s*-\\s*${effect}\\s*:\\s*GetOwnerPlayer\\s*\\(\\s*\\)`,
  );
  return reflectOpponentNonContinuous.test(snippet) ? "reflect-damage:opponent-non-continuous" : undefined;
}

function materialTargetPredicateDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const cardParam = params?.[1];
  if (!cardParam) return undefined;
  const card = escapeRegExp(cardParam);
  const notSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const setcode = notSetcode?.[1] ? luaNumberTokenValue(L, index, notSetcode[1]) : undefined;
  if (setcode !== undefined) return `cannot-material:target-not-setcode:${setcode}`;
  const notRace = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const race = notRace?.[1] ? luaNumberTokenValue(L, index, notRace[1]) : undefined;
  if (race !== undefined) return `cannot-material:target-not-race:${race}`;
  const notAttribute = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const attribute = notAttribute?.[1] ? luaNumberTokenValue(L, index, notAttribute[1]) : undefined;
  return attribute !== undefined ? `cannot-material:target-not-attribute:${attribute}` : undefined;
}

function valueCardPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const cardParam = params?.[1];
  if (!effectParam || !cardParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const card = escapeRegExp(cardParam);
  const notHandler = new RegExp(`\\breturn\\s+${card}\\s*~=\\s*${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*(?:end\\b|$)`);
  return notHandler.test(snippet) ? "value-card:not-handler" : undefined;
}

function specialSummonedMonsterActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const handler = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const specialSummoned = `${handler}\\s*:\\s*IsSpecialSummoned\\s*\\(\\s*\\)`;
  const monsterZone = `${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_MZONE|4)\\s*\\)`;
  const predicate = new RegExp(`\\breturn\\s+${monsterEffect}\\s+and\\s+${specialSummoned}\\s+and\\s+${monsterZone}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:special-summoned-monster-on-field" : undefined;
}

function nonSpiritMonsterActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const handler = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const nonSpirit = `not\\s+${handler}\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_SPIRIT|512)\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const predicate = new RegExp(`\\breturn\\s+${nonSpirit}\\s+and\\s+${monsterEffect}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:non-spirit-monster-effect" : undefined;
}

function spellTrapActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const predicate = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsSpellTrapEffect\\s*\\(\\s*\\)\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:spell-trap-effect" : undefined;
}

function cardActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const predicate = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16)\\s*\\)\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:card-activation" : undefined;
}

function typedCardActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const typeMethod = `${relatedEffect}\\s*:\\s*(IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)`;
  const cardActivation = `${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16)\\s*\\)`;
  const match = snippet.match(new RegExp(`\\breturn\\s+(?:${cardActivation}\\s+and\\s+${typeMethod}|${typeMethod}\\s+and\\s+${cardActivation})\\s*(?:end\\b|$)`));
  if (match?.[1] === "IsSpellEffect" || match?.[2] === "IsSpellEffect") return "cannot-activate:spell-card-activation";
  if (match?.[1] === "IsTrapEffect" || match?.[2] === "IsTrapEffect") return "cannot-activate:trap-card-activation";
  return undefined;
}

function sameCodeActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const relatedEffectParam = params?.[1];
  if (!effectParam || !relatedEffectParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const sameCode = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsCode\\s*\\(\\s*${effect}\\s*:\\s*GetLabel\\s*\\(\\s*\\)\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  if (new RegExp(`\\breturn\\s+(?:${monsterEffect}\\s+and\\s+${sameCode}|${sameCode}\\s+and\\s+${monsterEffect})\\s*(?:end\\b|$)`).test(snippet)) return "cannot-activate:same-code-monster-effect";
  const predicate = new RegExp(`\\breturn\\s+(?:${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16)\\s*\\)\\s+and\\s+)?${sameCode}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:same-code" : undefined;
}

function monsterAttributeExceptActivationPredicateDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const match = snippet.match(new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+and\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsAttributeExcept\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const attribute = match?.[1] ? luaNumberTokenValue(L, index, match[1]) : undefined;
  return attribute !== undefined ? `cannot-activate:monster-attribute-except:${attribute}` : undefined;
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

function reasonMaskPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const reasonParam = params?.[2];
  if (!reasonParam) return undefined;
  const reason = escapeRegExp(reasonParam);
  const maskTerm = "(?:REASON_EFFECT|64|REASON_BATTLE|32)";
  const maskExpression = `${maskTerm}(?:\\s*(?:\\||\\+)\\s*${maskTerm})*`;
  const condition = `${reason}\\s*&\\s*\\(?\\s*(${maskExpression})\\s*\\)?\\s*\\)?\\s*(?:(?:~=|>)\\s*0|==\\s*(${maskExpression}))`;
  const returnPredicate = new RegExp(
    `\\breturn\\s+\\(?\\s*${condition}\\s*\\)?\\s*(?:and\\s+(?:1|true)\\s+or\\s+(?:0|false))?\\s*(?:end\\b|$)`,
  );
  const returnMatch = snippet.match(returnPredicate);
  const returnMask = reasonMaskFromMatch(returnMatch);
  if (returnMask !== undefined) return reasonMaskDescriptor(returnMask);
  const ifPredicate = new RegExp(`\\bif\\s+\\(?\\s*${condition}\\s*\\)?\\s+then\\b.*\\breturn\\s+(?:1|true)\\s*(?:end\\b|$)`);
  const ifMatch = snippet.match(ifPredicate);
  const ifMask = reasonMaskFromMatch(ifMatch);
  return ifMask === undefined ? undefined : reasonMaskDescriptor(ifMask);
}

function reasonMaskFromMatch(match: RegExpMatchArray | null): number | undefined {
  const expression = match?.[1] ?? match?.[2];
  if (!expression) return undefined;
  return reasonMaskFromExpression(expression);
}

function reasonMaskDescriptor(mask: number): string {
  return mask === 0x40 ? "value-predicate:effect-reason" : `value-predicate:reason-mask:${mask}`;
}

function reasonMaskFromExpression(expression: string): number | undefined {
  let mask = 0;
  for (const part of expression.split(/\s*(?:\||\+)\s*/)) {
    const value = reasonMaskTermValue(part.trim());
    if (value === undefined) return undefined;
    mask |= value;
  }
  return mask === 0 ? undefined : mask;
}

function reasonMaskTermValue(term: string): number | undefined {
  if (term === "REASON_EFFECT" || term === "64") return 0x40;
  if (term === "REASON_BATTLE" || term === "32") return 0x20;
  return undefined;
}

function isNamedTableFunction(L: unknown, index: number, tableName: string, fieldName: string): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring(tableName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const same = Boolean(lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1));
  lua.lua_pop(L, 2);
  return same;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
