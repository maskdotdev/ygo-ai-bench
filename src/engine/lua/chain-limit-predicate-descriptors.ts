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
  const typeCheck = `${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_ACTION|${TYPE_ACTION})\\s*\\)`;
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

export function literalResponseMatchesChainPlayerOrSpellTrapNonActivatePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return false;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return false;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return false;
  const equality = terms.find((term) => simpleEqualityCompares(term, responsePlayerParam, chainPlayerParam));
  const spellTrapTerm = terms.find((term) => term !== equality);
  if (!equality || !spellTrapTerm) return false;
  const effect = escapeRegExp(effectParam);
  const spellTrapEffect = `${effect}\\s*:\\s*IsSpellTrapEffect\\s*\\(\\s*\\)`;
  const nonActivation = `not\\s+${effect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16)\\s*\\)`;
  return new RegExp(`^${spellTrapEffect}\\s+and\\s+${nonActivation}$`).test(spellTrapTerm)
    || new RegExp(`^${nonActivation}\\s+and\\s+${spellTrapEffect}$`).test(spellTrapTerm);
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

function activeTypeMethodMask(method: string): number | undefined {
  if (method === "IsMonsterEffect") return 0x1;
  if (method === "IsSpellEffect") return 0x2;
  if (method === "IsTrapEffect") return 0x4;
  return undefined;
}

const activeTypeMaskExpressionPattern = String.raw`(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|\d+)(?:\s*(?:\+|\|)\s*(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|\d+))*`;
const activeTypeMasks: Record<string, number> = {
  TYPE_MONSTER: 0x1,
  TYPE_SPELL: 0x2,
  TYPE_TRAP: 0x4,
};

function activeTypeMaskTokenValue(token: string): number | undefined {
  const parts = token.split(/\s*(?:\+|\|)\s*/).filter(Boolean);
  if (parts.length === 0) return undefined;
  let mask = 0;
  for (const part of parts) {
    const value = activeTypeMasks[part] ?? (/^\d+$/.test(part) ? Number(part) : undefined);
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
  return snippet.slice(index + "return ".length).replace(/\s+end\b.*$/, "").trim();
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
