import fengari from "fengari";
import { installAuxApi, installConstants, installDebugApi } from "#lua/basic-api.js";
import { installCardApi, pushCardTable } from "#lua/card-api.js";
import { installDuelApi } from "#lua/duel-api/index.js";
import { installGroupApi, pushGroupTable } from "#lua/group-api.js";
import { scriptFilenameForCard } from "#engine/data-loaders.js";
import { locationsFromMask, readCardUid, readTableNumberField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaDuelOperationInfo } from "#lua/duel-api/operation.js";

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
  ownerPlayer?: PlayerId;
  code?: number;
  range?: DuelLocation[];
  countLimit?: number;
  description?: number;
  category?: number;
  property?: number;
  targetRange?: [number, number?];
  hintTiming?: [number, number?];
  countLimitCode?: number;
  reset?: {
    flags: number;
    count?: number;
  };
  label?: number;
  labelObjectRef?: number;
  value?: number;
  valueRef?: number;
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
  activeContext: DuelEffectContext | undefined;
  operationInfos: LuaDuelOperationInfo[];
  possibleOperationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
  selectedUids: string[];
  pushEffectTable: (state: unknown, id: number) => void;
  getEffectTypeFlags: (id: number) => number | undefined;
}

export function createLuaScriptHost(session: DuelSession): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = {
    session,
    nextEffectId: 1,
    effects: new Map(),
    messages: [],
    activeTargetUids: undefined,
    activeContext: undefined,
    operationInfos: [],
    possibleOperationInfos: [],
    operatedUids: [],
    selectedUids: [],
    pushEffectTable(state, id) {
      pushLuaEffectTable(state, id, hostState);
    },
    getEffectTypeFlags(id) {
      return hostState.effects.get(id)?.typeFlags;
    },
  };
  lualib.luaL_openlibs(L);
  installConstants(L);
  installDebugApi(L, hostState.messages);
  installAuxApi(L, readLuaError);
  installDuelApi(L, session, hostState);
  installEffectApi(L, hostState);
  installCardApi(L, session, hostState, (card, luaEffect, state) => toDuelEffect(card, luaEffect, state, hostState));
  installGroupApi(L, hostState);

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
    pushLuaEffectTable(state, id, hostState);
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

function pushLuaEffectTable(L: unknown, id: number, hostState: LuaHostState): void {
  const { effects, session } = hostState;
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, id);
  lua.lua_setfield(L, -2, to_luastring("__effect_id"));
  pushEffectMethod(L, effects, "Clone", (state, effect) => {
    const cloneId = cloneLuaEffectRecord(hostState, effect);
    pushLuaEffectTable(state, cloneId, hostState);
    return 1;
  });
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
  pushEffectMethod(L, effects, "GetOwner", (state, effect) => {
    if (!effect.sourceUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, effect.sourceUid);
    return 1;
  });
  pushEffectMethod(L, effects, "GetActivateLocation", (state, effect) => {
    lua.lua_pushinteger(state, locationMaskFromLocation(hostState.activeContext?.activationLocation ?? sourceCard(session, effect)?.location));
    return 1;
  });
  pushEffectMethod(L, effects, "GetActivateSequence", (state, effect) => {
    lua.lua_pushinteger(state, hostState.activeContext?.activationSequence ?? sourceCard(session, effect)?.sequence ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetOwnerPlayer", (state, effect) => {
    effect.ownerPlayer = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    return 0;
  });
  pushEffectMethod(L, effects, "GetOwnerPlayer", (state, effect) => {
    lua.lua_pushinteger(state, effect.ownerPlayer ?? effectController(session, effect));
    return 1;
  });
  pushEffectMethod(L, effects, "GetType", getEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "GetCode", getEffectNumberField("code"));
  pushEffectMethod(L, effects, "GetDescription", getEffectNumberField("description"));
  pushEffectMethod(L, effects, "GetCategory", getEffectNumberField("category"));
  pushEffectMethod(L, effects, "GetProperty", getEffectNumberField("property"));
  pushEffectMethod(L, effects, "IsHasType", hasEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "IsHasCategory", hasEffectNumberField("category"));
  pushEffectMethod(L, effects, "IsHasProperty", hasEffectNumberField("property"));
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
  pushEffectMethod(L, effects, "SetValue", (state, effect) => {
    if (effect.valueRef !== undefined) lauxlib.luaL_unref(state, lua.LUA_REGISTRYINDEX, effect.valueRef);
    delete effect.valueRef;
    delete effect.value;
    if (lua.lua_isfunction(state, 2)) {
      lua.lua_pushvalue(state, 2);
      effect.valueRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    }
    else if (lua.lua_isnumber(state, 2)) effect.value = lua.lua_tointeger(state, 2);
    return 0;
  });
  pushEffectMethod(L, effects, "GetValue", (state, effect) => {
    if (effect.valueRef !== undefined) lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, effect.valueRef);
    else lua.lua_pushinteger(state, effect.value ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetTargetRange", (state, effect) => {
    const selfRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const opponentRange = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    effect.targetRange = opponentRange === undefined ? [selfRange] : [selfRange, opponentRange];
    return 0;
  });
  pushEffectMethod(L, effects, "GetTargetRange", (state, effect) => {
    lua.lua_pushinteger(state, effect.targetRange?.[0] ?? 0);
    lua.lua_pushinteger(state, effect.targetRange?.[1] ?? 0);
    return 2;
  });
  pushEffectMethod(L, effects, "SetRange", (state, effect) => {
    const firstRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (firstRange !== undefined) effect.range = locationsFromMask(firstRange);
    return 0;
  });
  pushEffectMethod(L, effects, "GetRange", (state, effect) => {
    lua.lua_pushinteger(state, locationMaskFromLocations(effect.range ?? []));
    return 1;
  });
  pushEffectMethod(L, effects, "SetCountLimit", (state, effect) => {
    effect.countLimit = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    if (lua.lua_isnumber(state, 3)) effect.countLimitCode = lua.lua_tointeger(state, 3);
    return 0;
  });
  pushEffectMethod(L, effects, "GetCountLimit", (state, effect) => {
    lua.lua_pushinteger(state, effect.countLimit ?? 0);
    lua.lua_pushinteger(state, effect.countLimitCode ?? 0);
    return 2;
  });
  pushEffectMethod(L, effects, "SetReset", (state, effect) => {
    const flags = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const count = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    effect.reset = count === undefined ? { flags } : { flags, count };
    return 0;
  });
  pushEffectMethod(L, effects, "GetReset", (state, effect) => {
    lua.lua_pushinteger(state, effect.reset?.flags ?? 0);
    lua.lua_pushinteger(state, effect.reset?.count ?? 0);
    return 2;
  });
  pushEffectMethod(L, effects, "Reset", (state, effect) => {
    effect.countLimit = 0;
    delete effect.countLimitCode;
    delete effect.reset;
    return 0;
  });
  pushEffectMethod(L, effects, "Delete", (_, effect) => {
    deleteRegisteredLuaEffects(session, effect);
    effects.delete(effect.id);
    return 0;
  });
  pushEffectMethod(L, effects, "SetCondition", setEffectFunctionField("conditionRef"));
  pushEffectMethod(L, effects, "SetCost", setEffectFunctionField("costRef"));
  pushEffectMethod(L, effects, "SetTarget", setEffectFunctionField("targetRef"));
  pushEffectMethod(L, effects, "GetCondition", getEffectFunctionField("conditionRef"));
  pushEffectMethod(L, effects, "GetCost", getEffectFunctionField("costRef"));
  pushEffectMethod(L, effects, "GetTarget", getEffectFunctionField("targetRef"));
  pushEffectMethod(L, effects, "GetOperation", getEffectFunctionField("operationRef"));
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

function cloneLuaEffectRecord(hostState: LuaHostState, effect: LuaEffectRecord): number {
  const id = hostState.nextEffectId;
  hostState.nextEffectId += 1;
  const clone: LuaEffectRecord = { ...effect, id };
  if (effect.range) clone.range = [...effect.range];
  if (effect.targetRange) clone.targetRange = [...effect.targetRange];
  if (effect.hintTiming) clone.hintTiming = [...effect.hintTiming];
  if (effect.reset) clone.reset = { ...effect.reset };
  hostState.effects.set(id, clone);
  return id;
}

function deleteRegisteredLuaEffects(session: DuelSession, effect: LuaEffectRecord): void {
  session.state.effects = session.state.effects.filter((candidate) => candidate.id !== luaEffectDuelId(effect) || candidate.sourceUid !== effect.sourceUid);
}

function luaEffectDuelId(effect: LuaEffectRecord): string {
  return `lua-${effect.id}${effect.code === undefined ? "" : `-${effect.code}`}`;
}

function setEffectNumberField(field: "typeFlags" | "code" | "description" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (lua.lua_isnumber(state, 2)) effect[field] = lua.lua_tointeger(state, 2);
    return 0;
  };
}

function getEffectNumberField(field: "typeFlags" | "code" | "description" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    lua.lua_pushinteger(state, effect[field] ?? 0);
    return 1;
  };
}

function hasEffectNumberField(field: "typeFlags" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, requested !== 0 && ((effect[field] ?? 0) & requested) === requested);
    return 1;
  };
}

function effectController(session: DuelSession, effect: LuaEffectRecord): PlayerId {
  const source = sourceCard(session, effect);
  return source?.controller ?? 0;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function sourceCard(session: DuelSession, effect: LuaEffectRecord): DuelCardInstance | undefined {
  return effect.sourceUid ? session.state.cards.find((candidate) => candidate.uid === effect.sourceUid) : undefined;
}

function setEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect[field] = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  };
}

function getEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef" | "operationRef") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    const ref = effect[field];
    if (ref === undefined) lua.lua_pushnil(state);
    else lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, ref);
    return 1;
  };
}

function toDuelEffect(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, hostState: LuaHostState): DuelEffectDefinition {
  const event = luaEffectEvent(luaEffect.typeFlags, luaEffect.code);
  const range = luaEffect.range ?? [card.location];
  const triggerEvent = triggerEventFromCode(luaEffect.code);
  luaEffect.sourceUid = card.uid;
  return {
    id: luaEffectDuelId(luaEffect),
    sourceUid: card.uid,
    controller: luaEffect.ownerPlayer ?? card.controller,
    ...(luaEffect.ownerPlayer === undefined ? {} : { ownerPlayer: luaEffect.ownerPlayer }),
    event,
    ...(luaEffect.code === undefined ? {} : { code: luaEffect.code }),
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range,
    oncePerTurn: (luaEffect.countLimit ?? 0) > 0,
    ...(luaEffect.countLimit === undefined ? {} : { countLimit: luaEffect.countLimit }),
    ...(luaEffect.countLimitCode === undefined ? {} : { countLimitCode: luaEffect.countLimitCode }),
    ...(luaEffect.reset === undefined ? {} : { reset: luaEffect.reset }),
    ...(luaEffect.description === undefined ? {} : { description: luaEffect.description }),
    ...(luaEffect.category === undefined ? {} : { category: luaEffect.category }),
    ...(luaEffect.property === undefined ? {} : { property: luaEffect.property }),
    ...(luaEffect.targetRange === undefined ? {} : { targetRange: luaEffect.targetRange }),
    ...(luaEffect.hintTiming === undefined ? {} : { hintTiming: luaEffect.hintTiming }),
    canActivate: (ctx) =>
      callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.conditionRef, true, "condition", ctx) &&
      (event !== "summonProcedure" || callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.valueRef, true, "value", ctx)),
    cost: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.costRef, true, "cost", ctx),
    target: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.targetRef, true, "target", ctx),
    operation: (ctx) => {
      if (luaEffect.operationRef === undefined) {
        ctx.log("Lua effect resolved without an operation");
        return;
      }
      withLuaCallbackContext(hostState, ctx, () => {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.operationRef);
        const legacyArgs = secondParameterName(L, -1) === "c";
        const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, "operation", legacyArgs, ctx);
        const status = lua.lua_pcall(L, argCount, 0, 0);
        if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
        ctx.log("Lua effect operation resolved");
      });
    },
  };
}

function luaEffectEvent(typeFlags: number, code: number | undefined): DuelEffectDefinition["event"] {
  if (code === 34) return "summonProcedure";
  if ((typeFlags & 0x2) !== 0) return "continuous";
  if ((typeFlags & 0x80) !== 0 || (typeFlags & 0x200) !== 0) return "trigger";
  if ((typeFlags & 0x100) !== 0 || (typeFlags & 0x400) !== 0) return "quick";
  if ((typeFlags & 0x800) !== 0) return "continuous";
  return "ignition";
}

function triggerEventFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === 34) return undefined;
  if (code === 1001) return "flipSummoned";
  if (code === 1100) return "normalSummoned";
  if (code === 1102) return "specialSummoned";
  if (code === 1014) return "sentToGraveyard";
  if (code === 1016) return "positionChanged";
  if (code === 1130) return "attackDeclared";
  if (code === 1140) return "battleDestroyed";
  return undefined;
}

function pushLuaEffectCallbackArgs(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, kind: LuaEffectCallbackKind, legacyArgs: boolean, ctx?: DuelEffectContext): number {
  pushLuaEffectTable(L, luaEffect.id, hostState);
  if (legacyArgs) {
    pushCardTable(L, card.uid);
    return 2;
  }
  lua.lua_pushinteger(L, ctx?.player ?? card.controller);
  pushGroupTable(L, ctx?.eventCard ? [ctx.eventCard.uid] : []);
  lua.lua_pushinteger(L, ctx?.eventCard?.controller ?? ctx?.player ?? card.controller);
  lua.lua_pushinteger(L, 0);
  pushRelatedEffectTable(L, hostState);
  lua.lua_pushinteger(L, ctx?.eventCard?.reason ?? 0);
  lua.lua_pushinteger(L, ctx?.eventCard?.controller ?? ctx?.player ?? card.controller);
  if (kind === "cost" || kind === "target") {
    lua.lua_pushinteger(L, ctx?.checkOnly ? 0 : 1);
    return 9;
  }
  return 8;
}

function secondParameterName(L: unknown, functionIndex: number): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, functionIndex);
  lua.lua_getglobal(L, to_luastring("debug"));
  lua.lua_getfield(L, -1, to_luastring("getlocal"));
  lua.lua_pushvalue(L, absoluteIndex);
  lua.lua_pushinteger(L, 2);
  const status = lua.lua_pcall(L, 2, 2, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  const name = lua.lua_isstring(L, -2) ? lua.lua_tojsstring(L, -2) : undefined;
  lua.lua_pop(L, 3);
  return name;
}

function pushRelatedEffectTable(L: unknown, hostState: LuaHostState): void {
  const link = hostState.session.state.chain[hostState.session.state.chain.length - 1];
  const id = Number(link?.effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) pushLuaEffectTable(L, id, hostState);
  else lua.lua_pushnil(L);
}

function locationMaskFromLocation(location: DuelLocation | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  return 0;
}

function locationMaskFromLocations(locations: DuelLocation[]): number {
  let mask = 0;
  if (locations.includes("deck")) mask |= 0x01;
  if (locations.includes("hand")) mask |= 0x02;
  if (locations.includes("monsterZone")) mask |= 0x04;
  if (locations.includes("spellTrapZone")) mask |= 0x08;
  if (locations.includes("graveyard")) mask |= 0x10;
  if (locations.includes("banished")) mask |= 0x20;
  if (locations.includes("extraDeck")) mask |= 0x40;
  return mask;
}

type LuaEffectCallbackKind = "condition" | "cost" | "target" | "operation" | "value";

function callLuaEffectBoolean(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, ref: number | undefined, fallback: boolean, kind: LuaEffectCallbackKind, ctx?: DuelEffectContext): boolean {
  if (ref === undefined) return fallback;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    const legacyArgs = secondParameterName(L, -1) === "c";
    if (legacyArgs && ctx?.checkOnly && (kind === "cost" || kind === "target")) {
      lua.lua_pop(L, 1);
      return fallback;
    }
    const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, kind, legacyArgs, ctx);
    const status = lua.lua_pcall(L, argCount, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnil(L, -1) ? fallback : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

function withLuaCallbackContext<T>(hostState: LuaHostState, ctx: DuelEffectContext | undefined, callback: () => T): T {
  const previousTargets = hostState.activeTargetUids;
  const previousContext = hostState.activeContext;
  hostState.activeTargetUids = ctx?.targetUids;
  hostState.activeContext = ctx;
  try {
    return callback();
  } finally {
    hostState.activeTargetUids = previousTargets;
    hostState.activeContext = previousContext;
  }
}
