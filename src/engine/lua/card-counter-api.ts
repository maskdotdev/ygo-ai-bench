import fengari from "fengari";
import { moveDuelCard } from "#duel/card-state.js";
import { isCounterPlacementPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { addDuelCardCounter, canAddDuelCardCounter, getDuelCardCounter, removeDuelCardCounter } from "#duel/counters.js";
import { collectDuelTriggerEffects } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { readTableStringField } from "#lua/api-utils.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import type { DuelCardInstance, DuelEventName, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

type LuaCardCounterHostState<EffectRecord extends LuaCardApiEffectRecord> = LuaCardApiState<EffectRecord> & LuaMoveImmunityHostState<EffectRecord> & LuaOperationTimingBoundaryHostState;

export function installCardCounterApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAddCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("AddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanAddCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanAddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanRemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushHasCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("HasCounter"));
  pushBooleanGetter(L, "HasCounters", session, (card) => Boolean(card && totalCounters(card) > 0));
}

function pushGetCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  lua.lua_pushinteger(L, getDuelCardCounter(card, counterType));
  return 1;
}

function pushHasCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  if (!card) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  if (!lua.lua_isnumber(L, 2)) {
    lua.lua_pushboolean(L, totalCounters(card) > 0);
    return 1;
  }
  lua.lua_pushboolean(L, getDuelCardCounter(card, lua.lua_tointeger(L, 2)) > 0);
  return 1;
}

function pushAddCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const added = Boolean(card && !luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect) && canPlaceCounter(session, card, count) && addDuelCardCounter(card, counterType, count));
  if (added && card) {
    markLuaOperationTimingBoundary(session, hostState);
    collectCounterEvent(session, hostState, "counterAdded", card, duelReason.effect);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushboolean(L, added);
  return 1;
}

function pushRemoveCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  const reasonIndex = hasPlayerArgument ? 5 : 4;
  const reason = lua.lua_isnumber(L, reasonIndex) ? lua.lua_tointeger(L, reasonIndex) : duelReason.effect;
  const removed = Boolean(card && !luaMoveBlockedByImmunity(L, session, hostState, card, reason) && removeDuelCardCounter(card, counterType, count));
  if (removed && card) {
    markLuaOperationTimingBoundary(session, hostState);
    collectCounterEvent(session, hostState, "counterRemoved", card, reason);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushboolean(L, removed);
  return 1;
}

function pushIsCanAddCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, canPlaceCounter(session, card, count));
  return 1;
}

function pushIsCanRemoveCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  lua.lua_pushboolean(L, getDuelCardCounter(card, counterType) >= Math.max(0, count));
  return 1;
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function totalCounters(card: DuelCardInstance): number {
  return Object.values(card.counters ?? {}).reduce((total, value) => total + value, 0);
}

function collectCounterEvent(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, eventName: DuelEventName, card: DuelCardInstance, reason: number): void {
  collectDuelTriggerEffects(session.state, eventName, card, luaEffectReasonPayload(hostState, reason, hostState.activeContext?.player ?? session.state.turnPlayer));
}

function canPlaceCounter(session: DuelSession, card: DuelCardInstance | undefined, count: number): boolean {
  return Boolean(card && canAddDuelCardCounter(card, count) && !isCounterPlacementPrevented(session.state, card, createCounterCheckContext(session)));
}

function createCounterCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}
