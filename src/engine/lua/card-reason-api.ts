import fengari from "fengari";
import { cardFieldNames } from "#lua/card-field-names.js";
import { copyGlobalFunctionToField, readCardUid, readTableNumberField } from "#lua/api-utils.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardReasonApiState {
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installCardReasonApi(L: unknown, session: DuelSession, hostState: LuaCardReasonApiState): void {
  pushNumberGetter(L, "GetReason", session, (card) => card?.reason ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session, 1);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => ((card.reason ?? 0) & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsReason"));
  pushNumberGetter(L, "GetReasonPlayer", session, (card) => card?.reasonPlayer ?? card?.controller ?? 0);
  pushPlayerMatcher(L, "IsReasonPlayer", session, (card, requested) => requested.includes(card.reasonPlayer ?? card.controller));
  pushNumberGetter(L, "GetTurnID", session, (card) => card?.turnId ?? 0);
  pushNumberGetter(L, "GetTurnCounter", session, (card) => card?.turnCounter ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => pushSetTurnCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetTurnCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session, 1);
    if (!card?.reasonCardUid) lua.lua_pushnil(state);
    else pushCardTable(state, card.reasonCardUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetReasonCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const reasonCard = readCard(state, session, 1);
    const target = readCard(state, session, 2);
    lua.lua_pushboolean(state, Boolean(reasonCard && target?.reasonCardUid === reasonCard.uid));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsReasonCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session, 1);
    if (card?.reasonEffectId === undefined) lua.lua_pushnil(state);
    else hostState.pushEffectTable(state, card.reasonEffectId);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetReasonEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session, 1);
    const effectId = readTableNumberField(state, 2, "__effect_id");
    lua.lua_pushboolean(state, Boolean(card && effectId !== undefined && card.reasonEffectId === effectId));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsReasonEffect"));
}

function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  for (const fieldName of cardFieldNames) copyGlobalFunctionToField(L, "Card", fieldName);
}

function readCard(L: unknown, session: DuelSession, index: number): DuelCardInstance | undefined {
  const uid = readCardUid(L, index);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session, 1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushPlayerMatcher(L: unknown, fieldName: string, session: DuelSession, matcher: (card: DuelCardInstance, requested: PlayerId[]) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session, 1);
    const requested = readRequestedPlayers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.length > 0 && matcher(card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSetTurnCounter(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session, 1);
  if (card) card.turnCounter = lua.lua_isnumber(L, 2) ? Math.max(0, lua.lua_tointeger(L, 2)) : 0;
  return 0;
}

function readRequestedPlayers(L: unknown, startIndex: number): PlayerId[] {
  return readRequestedNumbers(L, startIndex).map(normalizePlayer);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
