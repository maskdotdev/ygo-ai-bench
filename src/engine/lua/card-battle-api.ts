import fengari from "fengari";
import { duelReason } from "#duel/reasons.js";
import { positionFromMask, readCardUid } from "#lua/api-utils.js";
import type { CardPosition, DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardBattleApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetBattlePosition", session, (card) => positionMaskFromPosition(card?.battlePosition ?? card?.position));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requestedPosition && (card.battlePosition ?? card.position) === requestedPosition));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePosition"));
  pushBooleanGetter(L, "IsBattleDestroyed", session, (card) => Boolean(card && isBattleDestroyed(card)));
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function isBattleDestroyed(card: DuelCardInstance): boolean {
  return (card.reason ?? 0) === ((card.reason ?? 0) | duelReason.battle | duelReason.destroy);
}

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}
