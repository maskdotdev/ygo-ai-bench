import fengari from "fengari";
import type { LuaDuelChainApiHostState } from "#lua/duel-api/chain.js";

const { lua, to_luastring, to_jsstring } = fengari;

const TYPE_ACTION = 0x10000000;

export function literalActionTypeChainPlayerLimitPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const chainPlayerParam = params?.[2];
  const captured = capturedSinglePlayerUpvalue(L, index);
  if (!effectParam || !chainPlayerParam || !captured) return undefined;
  const effect = escapeRegExp(effectParam);
  const chainPlayer = escapeRegExp(chainPlayerParam);
  const capturedName = escapeRegExp(captured.name);
  const typeCheck = `${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_ACTION|${TYPE_ACTION}|0x10000000)\\s*\\)`;
  const mismatchedPlayer = `(?:${chainPlayer}\\s*~=\\s*1\\s*-\\s*${capturedName}|1\\s*-\\s*${capturedName}\\s*~=\\s*${chainPlayer})`;
  const matches = new RegExp(`\\breturn\\s+not\\s*\\(\\s*${typeCheck}\\s+and\\s+${mismatchedPlayer}\\s*\\)`).test(snippet);
  return matches ? `closure:not-source-type-unless-chain-player:${TYPE_ACTION}:${1 - captured.value}` : undefined;
}

export function literalCapturedPlayerComparisonPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  const captured = capturedSinglePlayerUpvalue(L, index);
  const returnExpression = lastReturnExpression(snippet);
  if (!responsePlayerParam || !chainPlayerParam || !captured || !returnExpression) return undefined;
  if (simpleEqualityCompares(returnExpression, responsePlayerParam, captured.name)) return `closure:response-player:${captured.value}`;
  if (simpleEqualityCompares(returnExpression, chainPlayerParam, captured.name)) return `closure:chain-player:${captured.value}`;
  return undefined;
}

export function literalFalsePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  return literalConstantBooleanPredicate(L, index, hostState, "false");
}

export function literalTruePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  return literalConstantBooleanPredicate(L, index, hostState, "true");
}

export function literalResponseMatchesChainPlayerOrSourceTypeNonActivatePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return undefined;
  const equality = terms.find((term) => simpleEqualityCompares(term, responsePlayerParam, chainPlayerParam));
  const sourceTypeTerm = terms.find((term) => term !== equality);
  if (!equality || !sourceTypeTerm) return undefined;
  const effect = escapeRegExp(effectParam);
  const nonActivation = `not\\s+${effect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16|0x10)\\s*\\)`;
  const sourceType = sourceTypeTerm.match(new RegExp(`^${effect}\\s*:\\s*(IsSpellTrapEffect|IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)\\s+and\\s+${nonActivation}$`))
    ?? sourceTypeTerm.match(new RegExp(`^${nonActivation}\\s+and\\s+${effect}\\s*:\\s*(IsSpellTrapEffect|IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)$`));
  return sourceType?.[1] ? sourceTypeNonActivationMethodMask(sourceType[1]) : undefined;
}

export function literalNotOpponentControlledTrapPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const effectParam = luaFunctionParams(snippet)?.[0];
  const responsePlayerParam = luaFunctionParams(snippet)?.[1];
  const returnExpression = lastReturnExpression(snippet);
  if (!effectParam || !responsePlayerParam || !returnExpression) return false;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return false;
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const trap = new RegExp(`^not\\s+${handler}\\s*:\\s*(?:IsTrap\\s*\\(\\s*\\)|IsType\\s*\\(\\s*(?:TYPE_TRAP|4|0x4)\\s*\\))$`);
  const opponent = new RegExp(`^not\\s+${handler}\\s*:\\s*IsControler\\s*\\(\\s*1\\s*-\\s*${escapeRegExp(responsePlayerParam)}\\s*\\)$`);
  return terms.some((term) => trap.test(term)) && terms.some((term) => opponent.test(term));
}

export function literalResponseMatchesChainPlayerOrNotSourceTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return undefined;
  const equality = terms.find((term) => simpleEqualityCompares(term, responsePlayerParam, chainPlayerParam));
  const sourceTypeTerm = terms.find((term) => term !== equality);
  if (!equality || !sourceTypeTerm) return undefined;
  return notSourceTypeHandlerTermMask(sourceTypeTerm, effectParam);
}

export function literalResponseMatchesChainPlayerOrActiveTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return undefined;
  const equality = terms.find((term) => simpleEqualityCompares(term, responsePlayerParam, chainPlayerParam));
  const activeTypeTerm = terms.find((term) => term !== equality);
  if (!equality || !activeTypeTerm) return undefined;
  const effect = escapeRegExp(effectParam);
  const compatibilityMatch = activeTypeTerm.match(new RegExp(`^${effect}\\s*:\\s*(IsMonsterEffect|IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)$`));
  if (compatibilityMatch?.[1]) return activeTypeMethodMask(compatibilityMatch[1]);
  const directMatch = activeTypeTerm.match(new RegExp(`^${effect}\\s*:\\s*IsActiveType\\s*\\(\\s*(${activeTypeMaskExpressionPattern})\\s*\\)$`));
  const mask = directMatch?.[1] ? activeTypeMaskTokenValue(directMatch[1]) : undefined;
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

export function literalResponseMatchesChainPlayerOrCurrentTargetCardsPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string[] | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  const targetUids = [...new Set(hostState.activeContext?.targetUids ?? [])].sort();
  if (!effectParam || !responsePlayerParam || !chainPlayerParam || targetUids.length === 0) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return undefined;
  const equality = terms.find((term) => simpleEqualityCompares(term, responsePlayerParam, chainPlayerParam));
  const targetTerm = terms.find((term) => term !== equality);
  if (!equality || !targetTerm) return undefined;
  const effect = escapeRegExp(effectParam);
  const aliases = [...snippet.matchAll(new RegExp(`local\\s+([A-Za-z_]\\w*)\\s*=\\s*Duel\\s*\\.\\s*GetChainInfo\\s*\\(\\s*0\\s*,\\s*CHAININFO_TARGET_CARDS\\s*\\)`, "g"))].flatMap((match) => match[1] ? [match[1]] : []);
  const chainInfoGroup = [
    ...aliases.map(escapeRegExp),
    String.raw`Duel\s*\.\s*GetChainInfo\s*\(\s*0\s*,\s*CHAININFO_TARGET_CARDS\s*\)`,
  ].join("|");
  const containsHandler = new RegExp(`^not\\s+(?:${chainInfoGroup})\\s*:\\s*IsContains\\s*\\(\\s*${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*\\)$`);
  return containsHandler.test(targetTerm) ? targetUids : undefined;
}

export function literalNotSourceTypeOrNotEffectTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): { sourceType: number; effectType: number; sourceSetcode?: number } | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const effectParam = luaFunctionParams(snippet)?.[0];
  if (!effectParam) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2 && terms.length !== 3) return undefined;
  const sourceTypes = terms.map((term) => notSourceTypeTermMask(term, effectParam)).filter((mask): mask is number => mask !== undefined);
  const effectTypes = terms.map((term) => notEffectTypeTermMask(term, effectParam)).filter((mask): mask is number => mask !== undefined);
  const sourceSetcodes = terms.map((term) => notSourceSetcodeTermValue(L, term, effectParam)).filter((setcode): setcode is number => setcode !== undefined);
  const sourceType = sourceTypes[0];
  const effectType = effectTypes[0];
  if (sourceTypes.length !== 1 || effectTypes.length !== 1 || sourceSetcodes.length > 1 || sourceType === undefined || effectType === undefined) return undefined;
  const sourceSetcode = sourceSetcodes[0];
  return sourceSetcode === undefined ? { sourceType, effectType } : { sourceType, effectType, sourceSetcode };
}

export function literalNotSourceOrActiveTypeAndEffectTypePredicateDescriptor(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const sourceEffectType = literalNotSourceTypeOrNotEffectTypePredicate(L, index, hostState);
  if (sourceEffectType?.sourceSetcode !== undefined) return `closure:not-source-type-effect-type-setcode:${sourceEffectType.sourceType}:${sourceEffectType.effectType}:${sourceEffectType.sourceSetcode}`;
  if (sourceEffectType) return `closure:not-source-type-effect-type:${sourceEffectType.sourceType}:${sourceEffectType.effectType}`;
  const activeEffectType = literalNotActiveTypeOrNotEffectTypePredicate(L, index, hostState);
  return activeEffectType ? `closure:not-active-type-effect-type:${activeEffectType.activeType}:${activeEffectType.effectType}` : undefined;
}

function literalNotActiveTypeOrNotEffectTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): { activeType: number; effectType: number } | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const effectParam = luaFunctionParams(snippet)?.[0];
  const returnExpression = lastReturnExpression(snippet);
  if (!effectParam || !returnExpression) return undefined;
  const effect = escapeRegExp(effectParam);
  const activeType = `${effect}\\s*:\\s*IsActiveType\\s*\\(\\s*(${activeTypeMaskExpressionPattern})\\s*\\)`;
  const effectType = `${effect}\\s*:\\s*IsHasType\\s*\\(\\s*(${effectTypeMaskExpressionPattern})\\s*\\)`;
  const activeThenEffect = returnExpression.match(new RegExp(`^not\\s*\\(\\s*${activeType}\\s+and\\s+${effectType}\\s*\\)$`));
  const effectThenActive = returnExpression.match(new RegExp(`^not\\s*\\(\\s*${effectType}\\s+and\\s+${activeType}\\s*\\)$`));
  const activeToken = activeThenEffect?.[1] ?? effectThenActive?.[2];
  const effectToken = activeThenEffect?.[2] ?? effectThenActive?.[1];
  const activeMask = activeToken ? activeTypeMaskTokenValue(activeToken) : undefined;
  const effectMask = effectToken ? effectTypeMaskTokenValue(effectToken) : undefined;
  return activeMask !== undefined && effectMask !== undefined ? { activeType: activeMask, effectType: effectMask } : undefined;
}

export function literalNotMonsterWithoutLevelActiveTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const effectParam = luaFunctionParams(snippet)?.[0];
  const returnExpression = lastReturnExpression(snippet);
  if (!effectParam || !returnExpression) return false;
  const effect = escapeRegExp(effectParam);
  const monsterEffect = `${effect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const noLevelHandler = `not\\s+${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*HasLevel\\s*\\(\\s*\\)`;
  return new RegExp(`^not\\s*\\(\\s*(?:${monsterEffect}\\s+and\\s+${noLevelHandler}|${noLevelHandler}\\s+and\\s+${monsterEffect})\\s*\\)$`).test(returnExpression);
}

export function literalStatelessSourcePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  const source = snippet ? returnOnlyAnonymousFunctionExpression(snippet) : undefined;
  return source ? restorableStatelessLuaChainLimitSource(source) : undefined;
}

export function capturedTypeMaskDescriptor(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const mask = capturedTypeMask(L, index);
  if (mask === undefined) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  return `${capturedTypeMaskUsesOriginalType(snippet) ? "closure:original-type-mask-response-player" : "closure:type-mask-response-player"}:${mask}`;
}

export function restorableStatelessLuaChainLimitSource(source: string): string | undefined {
  const normalized = source.trim();
  if (normalized.length === 0 || normalized.length > 1200) return undefined;
  return returnOnlyAnonymousFunctionExpression(normalized) === normalized ? normalized : undefined;
}

function capturedTypeMask(L: unknown, index: number): number | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const numbers: Array<{ name: string; value: number }> = [];
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (!lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      numbers.push({ name, value: lua.lua_tointeger(L, -1) });
    }
    lua.lua_pop(L, 1);
  }
  return numbers.length === 1 && isTypeMaskUpvalueName(numbers[0]!.name) ? numbers[0]!.value : undefined;
}

function capturedTypeMaskUsesOriginalType(snippet: string | undefined): boolean {
  return Boolean(snippet && /:\s*(?:GetOriginalType|IsOriginalType)\s*\(/.test(snippet));
}

function isTypeMaskUpvalueName(name: string): boolean {
  return name === "typ" || name === "typeMask" || name === "type_mask";
}

function returnOnlyAnonymousFunctionExpression(snippet: string): string | undefined {
  const source = anonymousFunctionExpression(snippet);
  if (source === undefined) return undefined;
  const match = source.match(/^function\s*\(([^)]*)\)\s*return\s+(.+?)\s*end$/);
  const params = match?.[1]?.split(",").map((param) => param.trim()).filter(Boolean) ?? [];
  const expression = match?.[2]?.replace(/;$/, "").trim();
  return expression !== undefined && statelessSourceExpressionIsReadOnly(expression, params) ? source : undefined;
}

function anonymousFunctionExpression(snippet: string): string | undefined {
  const start = snippet.indexOf("function");
  if (start < 0) return undefined;
  const tail = snippet.slice(start);
  if (!/^function\s*\(/.test(tail)) return undefined;
  let depth = 0;
  for (const match of tail.matchAll(/\b(function|end)\b/g)) {
    const token = match[1];
    if (!token) continue;
    depth += token === "function" ? 1 : -1;
    if (depth === 0) return tail.slice(0, match.index + token.length).trim();
  }
  return undefined;
}

function statelessSourceExpressionIsReadOnly(expression: string, params: string[]): boolean {
  if (expression.length === 0 || /["'.;[\]{}]/.test(expression) || !/^[A-Za-z0-9_(),:\s+\-*/%<>=~&|#]+$/.test(expression)) return false;
  const paramNames = new Set(params);
  const keywords = new Set(["and", "false", "nil", "not", "or", "return", "true"]);
  for (const identifier of expression.match(/[A-Za-z_]\w*/g) ?? []) {
    if (paramNames.has(identifier) || keywords.has(identifier)) continue;
    if (/^(TYPE_|EFFECT_|SET_)/.test(identifier)) continue;
    if (/^(Get|Is|Has)[A-Za-z_]\w*$/.test(identifier)) continue;
    return false;
  }
  return !/\bfunction\b/.test(expression);
}

function notSourceTypeTermMask(term: string, effectParam: string): number | undefined {
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const compatibilityMatch = term.match(new RegExp(`^not\\s+${handler}\\s*:\\s*(IsMonster|IsSpell|IsTrap)\\s*\\(\\s*\\)$`));
  if (compatibilityMatch?.[1]) return sourceTypeMethodMask(compatibilityMatch[1]);
  const directMatch = term.match(new RegExp(`^not\\s+${handler}\\s*:\\s*IsType\\s*\\(\\s*(${sourceTypeMaskExpressionPattern})\\s*\\)$`));
  const mask = directMatch?.[1] ? sourceTypeMaskTokenValue(directMatch[1]) : undefined;
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function notEffectTypeTermMask(term: string, effectParam: string): number | undefined {
  const match = term.match(new RegExp(`^not\\s+${escapeRegExp(effectParam)}\\s*:\\s*IsHasType\\s*\\(\\s*(${effectTypeMaskExpressionPattern})\\s*\\)$`));
  const mask = match?.[1] ? effectTypeMaskTokenValue(match[1]) : undefined;
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function notSourceSetcodeTermValue(L: unknown, term: string, effectParam: string): number | undefined {
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const match = term.match(new RegExp(`^not\\s+${handler}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)$`));
  const setcode = match?.[1] ? luaNumberTokenValue(L, match[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

function notSourceTypeHandlerTermMask(term: string, effectParam: string): number | undefined {
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const compatibilityMatch = term.match(new RegExp(`^not\\s+${handler}\\s*:\\s*(IsMonster|IsSpell|IsTrap|IsSpellTrap)\\s*\\(\\s*\\)$`));
  if (compatibilityMatch?.[1]) return sourceTypeMethodMask(compatibilityMatch[1]);
  const directMatch = term.match(new RegExp(`^not\\s+${handler}\\s*:\\s*IsType\\s*\\(\\s*(${sourceTypeMaskExpressionPattern})\\s*\\)$`));
  const mask = directMatch?.[1] ? sourceTypeMaskTokenValue(directMatch[1]) : undefined;
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function sourceTypeMethodMask(method: string): number | undefined {
  if (method === "IsMonster") return 0x1;
  if (method === "IsSpell") return 0x2;
  if (method === "IsTrap") return 0x4;
  if (method === "IsSpellTrap") return 0x6;
  return undefined;
}

function sourceTypeNonActivationMethodMask(method: string): number | undefined {
  if (method === "IsSpellTrapEffect") return 0x6;
  if (method === "IsSpellEffect") return 0x2;
  if (method === "IsTrapEffect") return 0x4;
  return undefined;
}

const numericMaskPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+)`;
const sourceTypeMaskExpressionPattern = String.raw`(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|${numericMaskPattern})(?:\s*(?:\+|\|)\s*(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|${numericMaskPattern}))*`;
const sourceTypeMasks: Record<string, number> = {
  TYPE_MONSTER: 0x1,
  TYPE_SPELL: 0x2,
  TYPE_TRAP: 0x4,
};

function sourceTypeMaskTokenValue(token: string): number | undefined {
  return maskTokenValue(token, sourceTypeMasks);
}

const effectTypeMaskExpressionPattern = String.raw`(?:EFFECT_TYPE_SINGLE|EFFECT_TYPE_FIELD|EFFECT_TYPE_EQUIP|EFFECT_TYPE_ACTIVATE|EFFECT_TYPE_IGNITION|EFFECT_TYPE_TRIGGER_O|EFFECT_TYPE_QUICK_O|EFFECT_TYPE_TRIGGER_F|EFFECT_TYPE_QUICK_F|EFFECT_TYPE_CONTINUOUS|${numericMaskPattern})(?:\s*(?:\+|\|)\s*(?:EFFECT_TYPE_SINGLE|EFFECT_TYPE_FIELD|EFFECT_TYPE_EQUIP|EFFECT_TYPE_ACTIVATE|EFFECT_TYPE_IGNITION|EFFECT_TYPE_TRIGGER_O|EFFECT_TYPE_QUICK_O|EFFECT_TYPE_TRIGGER_F|EFFECT_TYPE_QUICK_F|EFFECT_TYPE_CONTINUOUS|${numericMaskPattern}))*`;
const effectTypeMasks: Record<string, number> = {
  EFFECT_TYPE_SINGLE: 0x1,
  EFFECT_TYPE_FIELD: 0x2,
  EFFECT_TYPE_EQUIP: 0x4,
  EFFECT_TYPE_ACTIVATE: 0x10,
  EFFECT_TYPE_IGNITION: 0x40,
  EFFECT_TYPE_TRIGGER_O: 0x80,
  EFFECT_TYPE_QUICK_O: 0x100,
  EFFECT_TYPE_TRIGGER_F: 0x200,
  EFFECT_TYPE_QUICK_F: 0x400,
  EFFECT_TYPE_CONTINUOUS: 0x800,
};

function effectTypeMaskTokenValue(token: string): number | undefined {
  return maskTokenValue(token, effectTypeMasks);
}

const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;

function luaNumberTokenValue(L: unknown, token: string): number | undefined {
  if (/^0x[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[A-Za-z_]\w*$/.test(token)) return undefined;
  lua.lua_getglobal(L, to_luastring(token));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function activeTypeMethodMask(method: string): number | undefined {
  if (method === "IsMonsterEffect") return 0x1;
  if (method === "IsSpellEffect") return 0x2;
  if (method === "IsTrapEffect") return 0x4;
  return undefined;
}

const activeTypeMaskExpressionPattern = String.raw`(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|${numericMaskPattern})(?:\s*(?:\+|\|)\s*(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|${numericMaskPattern}))*`;
const activeTypeMasks: Record<string, number> = {
  TYPE_MONSTER: 0x1,
  TYPE_SPELL: 0x2,
  TYPE_TRAP: 0x4,
};

function activeTypeMaskTokenValue(token: string): number | undefined {
  return maskTokenValue(token, activeTypeMasks);
}

function maskTokenValue(token: string, masks: Record<string, number>): number | undefined {
  const parts = token.split(/\s*(?:\+|\|)\s*/).filter(Boolean);
  if (parts.length === 0) return undefined;
  let mask = 0;
  for (const part of parts) {
    const value = masks[part] ?? (/^0x[0-9A-Fa-f]+$/.test(part) ? Number.parseInt(part.slice(2), 16) : /^\d+$/.test(part) ? Number(part) : undefined);
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return undefined;
    mask |= value;
  }
  return mask;
}

function luaFunctionParams(snippet: string): string[] | undefined {
  const match = snippet.match(/function\s+(?:[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)\s*\(([^)]*)\)/)
    ?? snippet.match(/function\s*\(([^)]*)\)/);
  const params = match?.[1];
  return params?.split(",").map((param) => param.trim()).filter(Boolean);
}

function literalConstantBooleanPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState, literal: "false" | "true"): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const body = luaFunctionBody(snippet);
  const returned = body?.match(/^return\s+(.+?);?$/)?.[1];
  return returned !== undefined && trimOuterParens(returned) === literal;
}

function luaFunctionBody(snippet: string): string | undefined {
  const body = snippet.match(/function\s+(?:[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)\s*\([^)]*\)\s*(.*?)\s*end\b/)
    ?? snippet.match(/function\s*\([^)]*\)\s*(.*?)\s*end\b/);
  return body?.[1]?.trim();
}

function hasNonEnvironmentUpvalues(L: unknown, index: number): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return false;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    lua.lua_pop(L, 1);
    if (name !== "_ENV") return true;
  }
}

function lastReturnExpression(snippet: string): string | undefined {
  const index = snippet.lastIndexOf("return ");
  if (index < 0) return undefined;
  return snippet.slice(index + "return ".length).replace(/\s*end\b.*$/, "").trim();
}

function simpleEqualityCompares(expression: string, leftName: string, rightName: string): boolean {
  const equality = trimOuterParens(expression).match(/^([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)$/);
  if (!equality?.[1] || !equality[2]) return false;
  return [equality[1], equality[2]].sort().join(":") === [leftName, rightName].sort().join(":");
}

function trimOuterParens(value: string): string {
  let current = value.trim();
  while (current.startsWith("(") && current.endsWith(")") && outerParensWrapWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function outerParensWrapWholeExpression(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function luaFunctionSourceSnippet(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const location = luaFunctionSourceLocation(L, index);
  if (!location) return undefined;
  const source = hostState.loadedScriptBodies?.get(location.source);
  if (!source) return undefined;
  return source.split(/\r?\n/).slice(location.line - 1, location.lastLine).join(" ");
}

function luaFunctionSourceLocation(L: unknown, index: number): { source: string; line: number; lastLine: number } | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring("debug"));
  lua.lua_getfield(L, -1, to_luastring("getinfo"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  lua.lua_pushstring(L, to_luastring("S"));
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK || !lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  const source = readStringField(L, -1, "source");
  const line = readIntegerField(L, -1, "linedefined");
  const lastLine = readIntegerField(L, -1, "lastlinedefined");
  lua.lua_pop(L, 2);
  if (!source || line === undefined || lastLine === undefined || line < 1 || lastLine < line) return undefined;
  return { source, line, lastLine };
}

function readStringField(L: unknown, tableIndex: number, field: string): string | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readIntegerField(L: unknown, tableIndex: number, field: string): number | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function capturedSinglePlayerUpvalue(L: unknown, index: number): { name: string; value: 0 | 1 } | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  let captured: { name: string; value: 0 | 1 } | undefined;
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return captured;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (captured || !lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      const value = lua.lua_tointeger(L, -1);
      if (value !== 0 && value !== 1) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      captured = { name, value };
    }
    lua.lua_pop(L, 1);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
