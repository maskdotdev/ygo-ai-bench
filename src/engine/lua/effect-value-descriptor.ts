import fengari from "fengari";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

export function knownLuaEffectValueDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  if (isNamedTableFunction(L, index, "aux", "tgoval")) return "cannot-be-effect-target:opponent";
  if (isNamedTableFunction(L, index, "aux", "indoval")) return "indestructible:opponent";
  if (isNamedTableFunction(L, index, "aux", "indsval")) return "indestructible:self";
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectReasonPredicate = effectReasonPredicateDescriptor(snippet, params);
  if (effectReasonPredicate) return effectReasonPredicate;
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

function effectReasonPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const reasonParam = params?.[2];
  if (!reasonParam) return undefined;
  const reason = escapeRegExp(reasonParam);
  const effectReason = "(?:REASON_EFFECT|64)";
  const effectReasonPredicate = new RegExp(`\\breturn\\s+\\(?\\s*${reason}\\s*&\\s*${effectReason}\\s*\\)?\\s*(?:~=|>)\\s*0\\s*(?:end\\b|$)`);
  return effectReasonPredicate.test(snippet) ? "value-predicate:effect-reason" : undefined;
}

function luaFunctionSourceSnippet(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const location = luaFunctionSourceLocation(L, index);
  if (!location) return undefined;
  const source = hostState.loadedScriptBodies.get(location.source);
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

function luaFunctionParams(snippet: string): string[] | undefined {
  const match = snippet.match(/function(?:\s+[A-Za-z_][\w.]*\s*)?\(([^)]*)\)/);
  return match?.[1]?.split(",").map((part) => part.trim()).filter(Boolean);
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
