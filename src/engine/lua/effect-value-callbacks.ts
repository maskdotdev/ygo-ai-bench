import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { normalizeLuaDamageModifier } from "#lua/numeric-utils.js";
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
    if (luaEffect.code === 83) {
      hostState.pushEffectTable(L, luaEffect.id);
      pushRelatedEffectTable(L, hostState, ctx);
      lua.lua_pushinteger(L, ctx.eventValue ?? 0);
      lua.lua_pushinteger(L, ctx.eventReason ?? 0);
      lua.lua_pushinteger(L, reasonPlayer ?? ctx.eventReasonPlayer ?? ctx.player ?? card.controller);
      if (ctx.eventCard) pushCardTable(L, ctx.eventCard.uid);
      else lua.lua_pushnil(L);
      const status = lua.lua_pcall(L, 6, 1, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      const result = Boolean(lua.lua_toboolean(L, -1));
      lua.lua_pop(L, 1);
      return result;
    }
    if (luaEffect.code === 80 || luaEffect.code === 81 || luaEffect.code === 335) {
      hostState.pushEffectTable(L, luaEffect.id);
      pushRelatedEffectTable(L, hostState, ctx);
      lua.lua_pushinteger(L, ctx.eventReason ?? 0);
      lua.lua_pushinteger(L, reasonPlayer ?? ctx.eventReasonPlayer ?? ctx.player ?? card.controller);
      if (ctx.eventCard) pushCardTable(L, ctx.eventCard.uid);
      else lua.lua_pushnil(L);
      const status = lua.lua_pcall(L, 5, 1, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      const result = lua.lua_isnil(L, -1) ? true : Boolean(lua.lua_toboolean(L, -1));
      lua.lua_pop(L, 1);
      return result;
    }
    if (luaEffect.code === 42) {
      hostState.pushEffectTable(L, luaEffect.id);
      pushBattleOpponentTable(L, hostState, ctx);
      lua.lua_pushinteger(L, reasonPlayer ?? ctx.eventReasonPlayer ?? ctx.player ?? card.controller);
      const status = lua.lua_pcall(L, 3, 1, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      const result = lua.lua_isnil(L, -1) ? true : Boolean(lua.lua_toboolean(L, -1));
      lua.lua_pop(L, 1);
      return result;
    }
    if (luaEffect.code === 45 || luaEffect.code === 47) {
      hostState.pushEffectTable(L, luaEffect.id);
      pushRelatedEffectTable(L, hostState, ctx);
      lua.lua_pushinteger(L, ctx.eventReason ?? 0);
      lua.lua_pushinteger(L, reasonPlayer ?? ctx.eventReasonPlayer ?? ctx.player ?? card.controller);
      const status = lua.lua_pcall(L, 4, 1, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      const result = lua.lua_isnil(L, -1) ? true : Boolean(lua.lua_toboolean(L, -1));
      lua.lua_pop(L, 1);
      return result;
    }
    hostState.pushEffectTable(L, luaEffect.id);
    pushRelatedEffectTable(L, hostState, ctx);
    lua.lua_pushinteger(L, reasonPlayer ?? ctx.player ?? card.controller);
    const isSpecialSummonCondition = luaEffect.code === 30;
    if (isSpecialSummonCondition) lua.lua_pushinteger(L, effectiveSpecialSummonTypeCode(ctx.summonTypeCode));
    const status = lua.lua_pcall(L, isSpecialSummonCondition ? 4 : 3, 1, 0);
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
  amount: number,
  readLuaError: (state: unknown) => string,
): number | undefined {
  if (luaEffect.valueRef === undefined) return undefined;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    const argCount = pushBattleDamageValueArgs(L, luaEffect, player, amount);
    const status = lua.lua_pcall(L, argCount, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnumber(L, -1) ? normalizeLuaDamageModifier(lua.lua_tonumber(L, -1)) : undefined;
    lua.lua_pop(L, 1);
    return result;
  });
}

export function callLuaEffectLifePointValue(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  ctx: DuelEffectContext,
  player: PlayerId,
  amount: number,
  readLuaError: (state: unknown) => string,
): number | undefined {
  if (luaEffect.valueRef === undefined) return undefined;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    pushRelatedEffectTable(L, hostState, ctx);
    lua.lua_pushinteger(L, amount);
    lua.lua_pushinteger(L, ctx.eventReason ?? 0);
    lua.lua_pushinteger(L, ctx.eventReasonPlayer ?? player);
    if (ctx.eventCard) pushCardTable(L, ctx.eventCard.uid);
    else lua.lua_pushnil(L);
    const status = lua.lua_pcall(L, 6, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnumber(L, -1) ? normalizeLuaDamageModifier(lua.lua_tonumber(L, -1)) : undefined;
    lua.lua_pop(L, 1);
    return result;
  });
}

export function callLuaEffectStatValue(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  ctx: DuelEffectContext,
  card: DuelCardInstance,
  readLuaError: (state: unknown) => string,
): number | undefined {
  if (luaEffect.valueRef === undefined) return undefined;
  return withLuaCallbackContext(hostState, ctx, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.valueRef);
    hostState.pushEffectTable(L, luaEffect.id);
    pushCardTable(L, card.uid);
    const status = lua.lua_pcall(L, 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
    lua.lua_pop(L, 1);
    return result;
  });
}

function pushBattleDamageValueArgs(L: unknown, luaEffect: LuaEffectRecord, player: PlayerId, amount: number): number {
  if (luaEffect.code !== 82) {
    lua.lua_pushinteger(L, player);
    return 2;
  }
  lua.lua_pushnil(L);
  lua.lua_pushinteger(L, amount);
  lua.lua_pushinteger(L, 0);
  lua.lua_pushinteger(L, player);
  lua.lua_pushnil(L);
  return 6;
}

function pushBattleOpponentTable(L: unknown, hostState: LuaHostState, ctx: DuelEffectContext): void {
  const eventUid = ctx.eventCard?.uid;
  const attack = hostState.session.state.currentAttack ?? hostState.session.state.pendingBattle;
  const opponentUid = attack && eventUid === attack.attackerUid ? attack.targetUid : attack && eventUid === attack.targetUid ? attack.attackerUid : undefined;
  const opponent = opponentUid === undefined ? undefined : hostState.session.state.cards.find((card) => card.uid === opponentUid);
  if (opponent) pushCardTable(L, opponent.uid);
  else lua.lua_pushnil(L);
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

function pushRelatedEffectTable(L: unknown, hostState: LuaHostState, ctx: DuelEffectContext): void {
  if (ctx.relatedEffectId !== undefined && Number.isFinite(ctx.relatedEffectId)) {
    hostState.pushEffectTable(L, ctx.relatedEffectId);
    return;
  }
  const link = hostState.session.state.chain[hostState.session.state.chain.length - 1];
  const id = Number(link?.effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
}
