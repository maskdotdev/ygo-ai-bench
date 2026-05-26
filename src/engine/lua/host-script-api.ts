import fengari from "fengari";
import { applyLuaExtraDeckProcedureMetadata } from "#lua/extra-deck-procedure-metadata-api.js";
import { applyLuaNormalTributeMetadata } from "#lua/tribute-metadata-api.js";
import { pushCardTable } from "#lua/card-api.js";
import type { DuelSession } from "#duel/types.js";
import type { LuaHostState, LuaInitialEffectRegistrationResult, LuaPromptCoroutineResult, LuaPromptResumeValue, LuaScriptLoadResult } from "#lua/host-types.js";

const { lua, lauxlib, to_luastring } = fengari;

export function registerLuaInitialEffectsDetailed(L: unknown, session: DuelSession, hostState: LuaHostState, loadedScriptBodies: ReadonlyMap<string, string> = new Map()): LuaInitialEffectRegistrationResult[] {
  const results: LuaInitialEffectRegistrationResult[] = [];
  for (const card of session.state.cards) {
    lua.lua_getglobal(L, to_luastring(`c${card.code}`));
    if (!lua.lua_istable(L, -1)) {
      lua.lua_pop(L, 1);
      results.push({ code: card.code, uid: card.uid, ok: true, skipped: true });
      continue;
    }
    lua.lua_getfield(L, -1, to_luastring("initial_effect"));
    if (!lua.lua_isfunction(L, -1)) {
      lua.lua_pop(L, 2);
      results.push({ code: card.code, uid: card.uid, ok: true, skipped: true });
      continue;
    }
    lua.lua_getglobal(L, to_luastring("__duel_call_initial_effect"));
    lua.lua_insert(L, -2);
    pushCardTable(L, card.uid);
    const previousCode = session.state.cards.find((candidate) => candidate.uid === card.uid)?.code;
    const oldCode = hostState.currentScriptCardCode;
    hostState.currentScriptCardCode = previousCode ?? oldCode;
    const status = lua.lua_pcall(L, 2, 2, 0);
    hostState.currentScriptCardCode = oldCode;
    if (status !== lua.LUA_OK) {
      const error = readLuaError(L);
      lua.lua_pop(L, 1);
      results.push({ code: card.code, uid: card.uid, ok: false, error });
      continue;
    }
    const ok = Boolean(lua.lua_toboolean(L, -2));
    if (!ok) {
      const error = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) ?? "Lua script error" : readLuaError(L);
      lua.lua_pop(L, 3);
      results.push({ code: card.code, uid: card.uid, ok: false, error });
      continue;
    }
    lua.lua_pop(L, 3);
    applyLuaNormalTributeMetadata(L, card);
    applyLuaExtraDeckProcedureMetadata(L, card, loadedScriptBodies.get(`c${card.code}.lua`));
    results.push({ code: card.code, uid: card.uid, ok: true });
  }
  return results;
}

export function installTracebackHandler(L: unknown): void {
  const source = `
    local function __duel_format_error_value(value, depth, seen)
      local value_type=type(value)
      if value_type~="table" then return tostring(value) end
      if seen[value] then return "<cycle>" end
      if depth<=0 then return tostring(value) end
      seen[value]=true
      local parts={}
      for key,field in pairs(value) do
        parts[#parts+1]=tostring(key) .. "=" .. __duel_format_error_value(field, depth-1, seen)
      end
      seen[value]=nil
      table.sort(parts)
      if #parts==0 then return tostring(value) end
      return "{" .. table.concat(parts, ", ") .. "}"
    end
    function __duel_traceback(err)
      return debug.traceback(__duel_format_error_value(err, 3, {}), 2)
    end
    function __duel_call_initial_effect(fn, card)
      return xpcall(function() return fn(card) end, __duel_traceback)
    end
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("__duel_traceback.lua"));
  if (status === lua.LUA_OK) lua.lua_pcall(L, 0, 0, 0);
  else lua.lua_pop(L, 1);
}

export function loadLuaScriptFile(L: unknown, hostState: LuaHostState, name: string, forced: boolean): LuaScriptLoadResult {
  if (!forced && hostState.loadedScripts.has(name)) return { ok: true, name };
  const code = hostState.scriptSource?.readScript(name);
  if (code === undefined) return { ok: false, name, error: `Script ${name} was not found` };
  const previousCode = hostState.currentScriptCardCode;
  hostState.currentScriptCardCode = cardCodeFromScriptName(name) ?? previousCode;
  hostState.loadedScriptBodies.set(name, code);
  const result = runLuaScript(L, code, name);
  hostState.currentScriptCardCode = previousCode;
  if (result.ok) hostState.loadedScripts.add(name);
  return result;
}

export function runLuaCardScript(L: unknown, hostState: LuaHostState, code: string, name: string): LuaScriptLoadResult {
  const previousCode = hostState.currentScriptCardCode;
  hostState.currentScriptCardCode = cardCodeFromScriptName(name) ?? previousCode;
  const result = runLuaScript(L, code, name);
  hostState.currentScriptCardCode = previousCode;
  return result;
}

export function runLuaPromptCoroutine(L: unknown, hostState: LuaHostState, code: string, name: string): LuaPromptCoroutineResult {
  const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(name));
  if (loadStatus !== lua.LUA_OK) return { status: "error", error: readLuaError(L) };
  return runLuaPromptCoroutineFromStack(L, hostState, 0);
}

export function runLuaPromptCoroutineFromStack(L: unknown, hostState: LuaHostState, argCount: number): LuaPromptCoroutineResult {
  const thread = lua.lua_newthread(L);
  lua.lua_insert(L, -(argCount + 2));
  lua.lua_xmove(L, thread, argCount + 1);
  return resumeLuaPromptCoroutine(L, thread, hostState, argCount);
}

export function readLuaError(L: unknown): string {
  const tableMessage = readLuaErrorTableMessage(L);
  if (tableMessage) {
    lua.lua_pop(L, 1);
    return tableMessage;
  }
  if (lua.lua_isstring(L, -1)) {
    const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
    lua.lua_pop(L, 1);
    return message;
  }
  lauxlib.luaL_tolstring(L, -1);
  const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
  lua.lua_pop(L, 2);
  return message;
}

function resumeLuaPromptCoroutine(L: unknown, thread: unknown, hostState: LuaHostState, argCount: number): LuaPromptCoroutineResult {
  const previousBehavior = hostState.promptBehavior;
  const promptCount = hostState.promptDecisions.length;
  hostState.promptBehavior = "yield";
  try {
    const status = lua.lua_resume(thread, L, argCount);
    if (status === lua.LUA_YIELD) {
      const prompt = hostState.promptDecisions.at(-1);
      if (!prompt || hostState.promptDecisions.length === promptCount) return { status: "error", error: "Lua coroutine yielded without a prompt decision" };
      return {
        status: "yielded",
        prompt,
        resume(value) {
          const values = Array.isArray(value) ? value : [value];
          for (const resumeValue of values) pushLuaResumeValue(thread, resumeValue);
          return resumeLuaPromptCoroutine(L, thread, hostState, values.length);
        },
      };
    }
    if (status !== lua.LUA_OK) return { status: "error", error: readLuaError(thread) };
    return { status: "completed", values: readLuaStackValues(thread) };
  } finally {
    hostState.promptBehavior = previousBehavior;
  }
}

function pushLuaResumeValue(L: unknown, value: LuaPromptResumeValue): void {
  if (typeof value === "boolean") lua.lua_pushboolean(L, value);
  else if (typeof value === "number") lua.lua_pushinteger(L, value);
  else pushCodeIndexTable(L, value.code, value.index);
}

function pushCodeIndexTable(L: unknown, code: number, index: number): void {
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, code);
  lua.lua_rawseti(L, -2, 1);
  lua.lua_pushinteger(L, index);
  lua.lua_rawseti(L, -2, 2);
}

function readLuaStackValues(L: unknown): unknown[] {
  const values: unknown[] = [];
  for (let index = 1; index <= lua.lua_gettop(L); index += 1) values.push(readLuaStackValue(L, index));
  lua.lua_settop(L, 0);
  return values;
}

function readLuaStackValue(L: unknown, index: number): unknown {
  if (lua.lua_isboolean(L, index)) return Boolean(lua.lua_toboolean(L, index));
  if (lua.lua_isnumber(L, index)) return lua.lua_tonumber(L, index);
  if (lua.lua_isstring(L, index)) return lua.lua_tojsstring(L, index);
  if (lua.lua_isnoneornil(L, index)) return undefined;
  return undefined;
}

function cardCodeFromScriptName(name: string): string | undefined {
  return /^c(\d+)\.lua$/.exec(name.split(/[\\/]/).at(-1) ?? name)?.[1];
}

function runLuaScript(L: unknown, code: string, name: string): LuaScriptLoadResult {
  const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(name));
  if (loadStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
  const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
  if (callStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
  return { ok: true, name };
}

function readLuaErrorTableMessage(L: unknown): string | undefined {
  if (!lua.lua_istable(L, -1)) return undefined;
  const absoluteIndex = lua.lua_gettop(L);
  const fields: string[] = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, absoluteIndex) !== 0) {
    const key = lua.lua_tojsstring(L, -2) ?? (lua.lua_isnumber(L, -2) ? String(lua.lua_tonumber(L, -2)) : undefined);
    const value = lua.lua_tojsstring(L, -1) ?? (lua.lua_isnumber(L, -1) ? String(lua.lua_tonumber(L, -1)) : undefined);
    if (key && value) fields.push(`${key}: ${value}`);
    lua.lua_pop(L, 1);
  }
  return fields.length ? fields.join("; ") : undefined;
}
