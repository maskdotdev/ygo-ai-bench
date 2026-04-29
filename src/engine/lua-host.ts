import fengari from "fengari";
import { installAuxApi, installConstants, installDebugApi } from "./lua-basic-api.js";
import { installCardApi, pushCardTable } from "./lua-card-api.js";
import { installDuelApi } from "./lua-duel-api.js";
import { installGroupApi } from "./lua-group-api.js";
import { scriptFilenameForCard } from "./data-loaders.js";
import { locationsFromMask, readCardUid, readTableNumberField } from "./lua-api-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelLocation, DuelSession } from "./duel-types.js";
import type { LuaDuelOperationInfo } from "./lua-duel-api.js";

const { lua, lauxlib, lualib, to_luastring } = fengari;

export interface LuaScriptLoadResult {
  ok: boolean;
  error?: string;
  name: string;
}

export interface LuaScriptHost {
  readonly messages: string[];
  loadScript(code: string, name: string): LuaScriptLoadResult;
  loadCardScript(cardCode: string | number, source: LuaScriptSource): LuaScriptLoadResult;
  registerInitialEffects(): number;
  getGlobalString(name: string): string | undefined;
  getGlobalNumber(name: string): number | undefined;
}

export interface LuaScriptSource {
  readScript(name: string): string | undefined;
}

interface LuaEffectRecord {
  id: number;
  typeFlags: number;
  sourceUid?: string;
  code?: number;
  range?: DuelLocation[];
  countLimit?: number;
  description?: number;
  category?: number;
  property?: number;
  hintTiming?: [number, number?];
  label?: number;
  labelObjectRef?: number;
  conditionRef?: number;
  costRef?: number;
  targetRef?: number;
  operationRef?: number;
}

interface LuaHostState {
  session: DuelSession;
  nextEffectId: number;
  effects: Map<number, LuaEffectRecord>;
  messages: string[];
  activeTargetUids: string[] | undefined;
  operationInfos: LuaDuelOperationInfo[];
}

export function createLuaScriptHost(session: DuelSession): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = { session, nextEffectId: 1, effects: new Map(), messages: [], activeTargetUids: undefined, operationInfos: [] };
  lualib.luaL_openlibs(L);
  installConstants(L);
  installDebugApi(L, hostState.messages);
  installAuxApi(L, readLuaError);
  installDuelApi(L, session, hostState);
  installEffectApi(L, hostState);
  installCardApi(L, session, hostState, (card, luaEffect, state) => toDuelEffect(card, luaEffect, state, hostState));
  installGroupApi(L);

  return {
    messages: hostState.messages,
    loadScript(code, name) {
      const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(name));
      if (loadStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
      if (callStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      return { ok: true, name };
    },
    loadCardScript(cardCode, source) {
      const name = scriptFilenameForCard(cardCode);
      const code = source.readScript(name);
      if (code === undefined) return { ok: false, name, error: `Script ${name} was not found` };
      return this.loadScript(code, name);
    },
    registerInitialEffects() {
      let count = 0;
      for (const card of session.state.cards) {
        lua.lua_getglobal(L, to_luastring(`c${card.code}`));
        if (!lua.lua_istable(L, -1)) {
          lua.lua_pop(L, 1);
          continue;
        }
        lua.lua_getfield(L, -1, to_luastring("initial_effect"));
        if (!lua.lua_isfunction(L, -1)) {
          lua.lua_pop(L, 2);
          continue;
        }
        pushCardTable(L, card.uid);
        const status = lua.lua_pcall(L, 1, 0, 0);
        lua.lua_pop(L, 1);
        if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
        count += 1;
      }
      return count;
    },
    getGlobalString(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
    getGlobalNumber(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
  };
}

function installEffectApi(L: unknown, hostState: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = hostState.nextEffectId;
    hostState.nextEffectId += 1;
    const sourceUid = readCardUid(state, 1);
    hostState.effects.set(id, { id, typeFlags: 0, ...(sourceUid === undefined ? {} : { sourceUid }) });
    pushEffectTable(state, id, hostState.effects, hostState.session);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateEffect"));
  lua.lua_setglobal(L, to_luastring("Effect"));
}

function readLuaError(L: unknown): string {
  const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
  lua.lua_pop(L, 1);
  return message;
}

function pushEffectTable(L: unknown, id: number, effects: Map<number, LuaEffectRecord>, session: DuelSession): void {
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, id);
  lua.lua_setfield(L, -2, to_luastring("__effect_id"));
  pushEffectMethod(L, effects, "GetHandler", (state, effect) => {
    if (!effect.sourceUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, effect.sourceUid);
    return 1;
  });
  pushEffectMethod(L, effects, "GetHandlerPlayer", (state, effect) => {
    const source = effect.sourceUid ? session.state.cards.find((candidate) => candidate.uid === effect.sourceUid) : undefined;
    lua.lua_pushinteger(state, source?.controller ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetType", setEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "SetCode", setEffectNumberField("code"));
  pushEffectMethod(L, effects, "SetDescription", setEffectNumberField("description"));
  pushEffectMethod(L, effects, "SetCategory", setEffectNumberField("category"));
  pushEffectMethod(L, effects, "SetProperty", setEffectNumberField("property"));
  pushEffectMethod(L, effects, "SetHintTiming", (state, effect) => {
    const primary = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (primary === undefined) return 0;
    const secondary = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    effect.hintTiming = secondary === undefined ? [primary] : [primary, secondary];
    return 0;
  });
  pushEffectMethod(L, effects, "SetLabel", (state, effect) => {
    effect.label = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    return 0;
  });
  pushEffectMethod(L, effects, "GetLabel", (state, effect) => {
    lua.lua_pushinteger(state, effect.label ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetLabelObject", (state, effect) => {
    if (effect.labelObjectRef !== undefined) lauxlib.luaL_unref(state, lua.LUA_REGISTRYINDEX, effect.labelObjectRef);
    if (lua.lua_isnoneornil(state, 2)) {
      delete effect.labelObjectRef;
      return 0;
    }
    lua.lua_pushvalue(state, 2);
    effect.labelObjectRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  });
  pushEffectMethod(L, effects, "GetLabelObject", (state, effect) => {
    if (effect.labelObjectRef === undefined) lua.lua_pushnil(state);
    else lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, effect.labelObjectRef);
    return 1;
  });
  pushEffectMethod(L, effects, "SetRange", (state, effect) => {
    const firstRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (firstRange !== undefined) effect.range = locationsFromMask(firstRange);
    return 0;
  });
  pushEffectMethod(L, effects, "SetCountLimit", (state, effect) => {
    effect.countLimit = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    return 0;
  });
  pushEffectMethod(L, effects, "SetCondition", setEffectFunctionField("conditionRef"));
  pushEffectMethod(L, effects, "SetCost", setEffectFunctionField("costRef"));
  pushEffectMethod(L, effects, "SetTarget", setEffectFunctionField("targetRef"));
  pushEffectMethod(L, effects, "SetOperation", (state, effect) => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect.operationRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  });
}

function pushEffectMethod(L: unknown, effects: Map<number, LuaEffectRecord>, name: string, handler: (state: unknown, effect: LuaEffectRecord) => number): void {
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const effectId = readTableNumberField(state, 1, "__effect_id");
    const effect = effectId === undefined ? undefined : effects.get(effectId);
    return effect ? handler(state, effect) : 0;
  });
  lua.lua_setfield(L, -2, to_luastring(name));
}

function setEffectNumberField(field: "typeFlags" | "code" | "description" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (lua.lua_isnumber(state, 2)) effect[field] = lua.lua_tointeger(state, 2);
    return 0;
  };
}

function setEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect[field] = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  };
}

function toDuelEffect(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, hostState: LuaHostState): DuelEffectDefinition {
  const event = (luaEffect.typeFlags & 0x20) !== 0 ? "trigger" : (luaEffect.typeFlags & 0x100) !== 0 ? "quick" : "ignition";
  const range = luaEffect.range ?? [card.location];
  const triggerEvent = triggerEventFromCode(luaEffect.code);
  luaEffect.sourceUid = card.uid;
  return {
    id: `lua-${luaEffect.id}${luaEffect.code === undefined ? "" : `-${luaEffect.code}`}`,
    sourceUid: card.uid,
    controller: card.controller,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range,
    oncePerTurn: (luaEffect.countLimit ?? 0) > 0,
    ...(luaEffect.description === undefined ? {} : { description: luaEffect.description }),
    ...(luaEffect.category === undefined ? {} : { category: luaEffect.category }),
    ...(luaEffect.property === undefined ? {} : { property: luaEffect.property }),
    ...(luaEffect.hintTiming === undefined ? {} : { hintTiming: luaEffect.hintTiming }),
    canActivate: () => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.conditionRef, true),
    cost: () => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.costRef, true),
    target: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.targetRef, true, ctx),
    operation: (ctx) => {
      if (luaEffect.operationRef === undefined) {
        ctx.log("Lua effect resolved without an operation");
        return;
      }
      withActiveTargets(hostState, ctx.targetUids, () => {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.operationRef);
        pushEffectTable(L, luaEffect.id, hostState.effects, hostState.session);
        pushCardTable(L, card.uid);
        const status = lua.lua_pcall(L, 2, 0, 0);
        if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
        ctx.log("Lua effect operation resolved");
      });
    },
  };
}

function triggerEventFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === 1001) return "flipSummoned";
  if (code === 0x40) return "normalSummoned";
  if (code === 0x80) return "specialSummoned";
  if (code === 0x400) return "sentToGraveyard";
  if (code === 1016) return "positionChanged";
  if (code === 1130) return "attackDeclared";
  if (code === 1140) return "battleDestroyed";
  return undefined;
}

function callLuaEffectBoolean(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, ref: number | undefined, fallback: boolean, ctx?: DuelEffectContext): boolean {
  if (ref === undefined) return fallback;
  return withActiveTargets(hostState, ctx?.targetUids, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    pushEffectTable(L, luaEffect.id, hostState.effects, hostState.session);
    pushCardTable(L, card.uid);
    const status = lua.lua_pcall(L, 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnil(L, -1) ? fallback : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

function withActiveTargets<T>(hostState: LuaHostState, targetUids: string[] | undefined, callback: () => T): T {
  const previous = hostState.activeTargetUids;
  hostState.activeTargetUids = targetUids;
  try {
    return callback();
  } finally {
    hostState.activeTargetUids = previous;
  }
}
