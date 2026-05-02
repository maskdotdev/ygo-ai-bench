import fengari from "fengari";
import { addDuelCardCounter, canAddDuelCardCounter, getDuelCardCounter, removeDuelCardCounter } from "#duel/counters.js";
import { readTableStringField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardCounterApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAddCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("AddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session));
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

function pushAddCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, addDuelCardCounter(card, counterType, count));
  return 1;
}

function pushRemoveCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  lua.lua_pushboolean(L, removeDuelCardCounter(card, counterType, count));
  return 1;
}

function pushIsCanAddCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, canAddDuelCardCounter(card, count));
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
