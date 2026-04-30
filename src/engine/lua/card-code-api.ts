import fengari from "fengari";
import { readCardUid, readTableStringField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardCodeApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetCode", session, (card) => (card ? Number(card.code) : 0));
  pushNumberGetter(L, "GetOriginalCode", session, (card) => (card ? Number(card.code) : 0));
  pushNumberGetter(L, "GetOriginalCodeRule", session, (card) => (card ? Number(card.code) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && !cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && listedCodes(card).some((code) => readRequestedCodes(state, 2).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCodeRule"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const firstCodeIndex = lua.lua_isnumber(state, 4) ? 4 : 2;
    lua.lua_pushboolean(state, Boolean(card && matchesAnyCodeAtOrAfter(state, card, firstCodeIndex)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && !card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && cardCodes(card).includes("1378")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsInfinity"));
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1) ?? readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function listedCodes(card: DuelCardInstance): string[] {
  return [...(card.data.listedNames ?? []), ...(card.data.fitMonster ?? [])].map(String);
}

function readRequestedCodes(L: unknown, start: number): string[] {
  const codes: string[] = [];
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) codes.push(String(lua.lua_tointeger(L, index)));
  }
  return codes;
}

function matchesAnyCodeAtOrAfter(L: unknown, card: DuelCardInstance, start: number): boolean {
  const codes = cardCodes(card);
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index) && codes.includes(String(lua.lua_tointeger(L, index)))) return true;
  }
  return false;
}
