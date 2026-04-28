import fengari from "fengari";
import { scriptFilenameForCard } from "./data-loaders.js";
import { registerEffect } from "./duel-core.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelSession } from "./duel-types.js";

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
  code?: number;
  range?: DuelLocation[];
  countLimit?: number;
  operationRef?: number;
}

interface LuaHostState {
  nextEffectId: number;
  effects: Map<number, LuaEffectRecord>;
  messages: string[];
}

export function createLuaScriptHost(session: DuelSession): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = { nextEffectId: 1, effects: new Map(), messages: [] };
  lualib.luaL_openlibs(L);
  installConstants(L);
  installDebugApi(L, hostState.messages);
  installDuelApi(L, session, hostState.messages);
  installEffectApi(L, hostState);
  installCardApi(L, session, hostState);
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

function installConstants(L: unknown): void {
  const constants: Record<string, number> = {
    LOCATION_DECK: 0x01,
    LOCATION_HAND: 0x02,
    LOCATION_MZONE: 0x04,
    LOCATION_SZONE: 0x08,
    LOCATION_GRAVE: 0x10,
    LOCATION_REMOVED: 0x20,
    LOCATION_EXTRA: 0x40,
    POS_FACEUP_ATTACK: 0x1,
    POS_FACEDOWN_DEFENSE: 0x8,
    EFFECT_TYPE_IGNITION: 0x10,
    EFFECT_TYPE_TRIGGER_O: 0x20,
    EFFECT_TYPE_QUICK_O: 0x100,
    EVENT_SUMMON_SUCCESS: 0x40,
    RESET_EVENT: 0x1000,
    RESETS_STANDARD: 0x2000,
  };
  for (const [name, value] of Object.entries(constants)) {
    lua.lua_pushinteger(L, value);
    lua.lua_setglobal(L, to_luastring(name));
  }
}

function installDebugApi(L: unknown, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Message"));
  lua.lua_setglobal(L, to_luastring("Debug"));
}

function installDuelApi(L: unknown, session: DuelSession, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushliteral(state, session.state.phase);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_setglobal(L, to_luastring("Duel"));
}

function installEffectApi(L: unknown, hostState: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = hostState.nextEffectId;
    hostState.nextEffectId += 1;
    hostState.effects.set(id, { id, typeFlags: 0 });
    pushEffectTable(state, id, hostState.effects);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateEffect"));
  lua.lua_setglobal(L, to_luastring("Effect"));
}

function installCardApi(L: unknown, session: DuelSession, hostState: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const cardUid = readTableStringField(state, 1, "__duel_uid");
    const effectId = readTableNumberField(state, 2, "__effect_id");
    const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
    const luaEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
    if (!card || !luaEffect) return 0;
    registerEffect(session, toDuelEffect(card, luaEffect, state, hostState.effects));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  lua.lua_setglobal(L, to_luastring("Card"));
}

function installGroupApi(L: unknown): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_newtable(state);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateGroup"));
  lua.lua_setglobal(L, to_luastring("Group"));
}

function readLuaError(L: unknown): string {
  const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
  lua.lua_pop(L, 1);
  return message;
}

function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  copyGlobalFunctionToField(L, "Card", "RegisterEffect");
}

function pushEffectTable(L: unknown, id: number, effects: Map<number, LuaEffectRecord>): void {
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, id);
  lua.lua_setfield(L, -2, to_luastring("__effect_id"));
  pushEffectMethod(L, effects, "SetType", setEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "SetCode", setEffectNumberField("code"));
  pushEffectMethod(L, effects, "SetRange", (state, effect) => {
    const firstRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (firstRange !== undefined) effect.range = locationsFromMask(firstRange);
    return 0;
  });
  pushEffectMethod(L, effects, "SetCountLimit", (state, effect) => {
    effect.countLimit = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    return 0;
  });
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

function setEffectNumberField(field: "typeFlags" | "code") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (lua.lua_isnumber(state, 2)) effect[field] = lua.lua_tointeger(state, 2);
    return 0;
  };
}

function toDuelEffect(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, effects: Map<number, LuaEffectRecord>): DuelEffectDefinition {
  const event = (luaEffect.typeFlags & 0x100) !== 0 ? "quick" : "ignition";
  const range = luaEffect.range ?? [card.location];
  return {
    id: `lua-${luaEffect.id}${luaEffect.code === undefined ? "" : `-${luaEffect.code}`}`,
    sourceUid: card.uid,
    controller: card.controller,
    event,
    range,
    oncePerTurn: (luaEffect.countLimit ?? 0) > 0,
    operation: (ctx) => {
      if (luaEffect.operationRef === undefined) {
        ctx.log("Lua effect resolved without an operation");
        return;
      }
      lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.operationRef);
      pushEffectTable(L, luaEffect.id, effects);
      pushCardTable(L, card.uid);
      const status = lua.lua_pcall(L, 2, 0, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      ctx.log("Lua effect operation resolved");
    },
  };
}

function copyGlobalFunctionToField(L: unknown, tableName: string, fieldName: string): void {
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  lua.lua_setfield(L, -3, to_luastring(fieldName));
  lua.lua_pop(L, 1);
}

function readTableStringField(L: unknown, index: number, fieldName: string): string | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readTableNumberField(L: unknown, index: number, fieldName: string): number | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function locationsFromMask(mask: number): DuelLocation[] {
  const locations: DuelLocation[] = [];
  if ((mask & 0x01) !== 0) locations.push("deck");
  if ((mask & 0x02) !== 0) locations.push("hand");
  if ((mask & 0x04) !== 0) locations.push("monsterZone");
  if ((mask & 0x08) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x10) !== 0) locations.push("graveyard");
  if ((mask & 0x20) !== 0) locations.push("banished");
  if ((mask & 0x40) !== 0) locations.push("extraDeck");
  return locations;
}
