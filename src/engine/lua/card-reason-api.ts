import fengari from "fengari";
import { cardFieldNames } from "#lua/card-field-names.js";
import { copyGlobalFunctionToField, readCardUid, readTableNumberField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardReasonApiState {
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installCardReasonApi(L: unknown, session: DuelSession, hostState: LuaCardReasonApiState): void {
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
