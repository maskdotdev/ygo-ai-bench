import fengari from "fengari";
import { readCardUid, readTableStringField } from "#lua/api-utils.js";
import { installCardCodeAnimeApi } from "#lua/card-code-anime-api.js";
import { cardCodes, cardSetcodes, isSetcodeMatch, listedCodes, listedCodeSetcodes, materialCodes, materialSetcodes, readRequestedCodes, readRequestedNumbers } from "#lua/card-code-utils.js";
import { effectiveCardCode, effectiveCardCodes } from "#lua/card-code-effect-utils.js";
import { effectiveCardSetcodes } from "#lua/card-setcode-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardCodeApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: { effects: ReadonlyMap<number, EffectRecord> }): void {
  pushNumberGetter(L, "GetCode", session, (card) => effectiveCardCode(session.state, card, hostState));
  pushNumberGetter(L, "GetOriginalCode", session, (card) => (card ? Number(card.code) : 0));
  pushNumberGetter(L, "GetOriginalCodeRule", session, (card) => (card ? Number(card.code) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (!card) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardScriptTable(state, card.code);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMetatable"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((code) => effectiveCardCodes(session.state, card, hostState).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.length > 0 && requested.every((code) => !effectiveCardCodes(session.state, card, hostState).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card && allListedCodes(state, card).some((code) => requested.includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && allListedCodes(state, card).some((code) => listedCodeSetcodes(session, code).some((setcode) => requested.some((wanted) => isSetcodeMatch(wanted, setcode))))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCodeWithArchetype"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && allMaterialCodes(state, card).some((code) => readRequestedCodes(state, 2).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCodeAsMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && allMaterialSetcodes(state, card).some((setcode) => readRequestedNumbers(state, 2).some((requested) => isSetcodeMatch(requested, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsArchetypeAsMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.code)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.code)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCodeRule"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const firstCodeIndex = lua.lua_isnumber(state, 4) ? 4 : 2;
    const requested = readRequestedCodes(state, firstCodeIndex);
    lua.lua_pushboolean(state, Boolean(card && requested.some((code) => effectiveCardCodes(session.state, card, hostState).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((wanted) => effectiveCardSetcodes(session.state, card, hostState).some((setcode) => isSetcodeMatch(wanted, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((wanted) => cardSetcodes(card).some((setcode) => isSetcodeMatch(wanted, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalSetCard"));
  pushNumberGetter(L, "GetSetCard", session, (card) => (card ? effectiveCardSetcodes(session.state, card, hostState)[0] ?? 0 : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.length > 0 && requested.every((wanted) => !effectiveCardSetcodes(session.state, card, hostState).some((setcode) => isSetcodeMatch(wanted, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && cardCodes(card).includes("1378")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsInfinity"));
  installCardCodeAnimeApi(L, session);
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

function allListedCodes(L: unknown, card: DuelCardInstance): string[] {
  return [...new Set([...listedCodes(card), ...scriptListedCodes(L, card.code)])];
}

function allMaterialCodes(L: unknown, card: DuelCardInstance): string[] {
  return [...new Set([...materialCodes(card), ...scriptNumberListField(L, card.code, "material").map(String)])];
}

function allMaterialSetcodes(L: unknown, card: DuelCardInstance): number[] {
  return [...new Set([...materialSetcodes(card), ...scriptNumberListField(L, card.code, "material_setcode")])];
}

function scriptListedCodes(L: unknown, code: string): string[] {
  return scriptNumberListField(L, code, "listed_names").map(String);
}

function scriptNumberListField(L: unknown, code: string, fieldName: string): number[] {
  const result: number[] = [];
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return result;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  if (lua.lua_istable(L, -1)) {
    const length = lua.lua_rawlen(L, -1);
    for (let index = 1; index <= length; index += 1) {
      lua.lua_rawgeti(L, -1, index);
      if (lua.lua_isnumber(L, -1)) result.push(lua.lua_tointeger(L, -1));
      lua.lua_pop(L, 1);
    }
  } else if (lua.lua_isnumber(L, -1)) {
    result.push(lua.lua_tointeger(L, -1));
  }
  lua.lua_pop(L, 2);
  return result;
}

function pushCardScriptTable(L: unknown, code: string): void {
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  if (lua.lua_istable(L, -1)) return;
  lua.lua_pop(L, 1);
  lua.lua_newtable(L);
  lua.lua_pushvalue(L, -1);
  lua.lua_setglobal(L, to_luastring(`c${code}`));
}
