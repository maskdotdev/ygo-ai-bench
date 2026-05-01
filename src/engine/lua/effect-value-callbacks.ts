import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import type { DuelCardInstance, DuelEffectContext, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord, LuaHostState } from "#lua/host-types.js";

const { lua } = fengari;

export function callLuaEffectValuePredicate(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  card: DuelCardInstance,
  ctx: DuelEffectContext,
  reasonPlayer: PlayerId | undefined,
  readLuaError: (state: unknown) => string,
): boolean {
  if (luaEffect.valueRef === undefined) return true;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    pushRelatedEffectTable(L, hostState);
    lua.lua_pushinteger(L, reasonPlayer ?? ctx.player ?? card.controller);
    const status = lua.lua_pcall(L, 3, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnil(L, -1) ? true : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

export function callLuaEffectValueCardPredicate(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  ctx: DuelEffectContext,
  card: DuelCardInstance,
  readLuaError: (state: unknown) => string,
): boolean {
  if (luaEffect.valueRef === undefined) return true;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    pushCardTable(L, card.uid);
    const status = lua.lua_pcall(L, 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnil(L, -1) ? true : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

export function callLuaEffectBattleDamageValue(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  ctx: DuelEffectContext,
  player: PlayerId,
  readLuaError: (state: unknown) => string,
): number | undefined {
  if (luaEffect.valueRef === undefined) return undefined;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    lua.lua_pushinteger(L, player);
    const status = lua.lua_pcall(L, 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
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

function pushRelatedEffectTable(L: unknown, hostState: LuaHostState): void {
  const link = hostState.session.state.chain[hostState.session.state.chain.length - 1];
  const id = Number(link?.effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
}
