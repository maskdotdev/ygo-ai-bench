import fengari from "fengari";
import { duelReason } from "#duel/reasons.js";
import { readCardUid } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { CardPosition, DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardBattleApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetBattlePosition", session, (card) => positionMaskFromPosition(card?.battlePosition ?? card?.position));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const battlePosition = positionMaskFromPosition(card?.battlePosition ?? card?.position);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => (battlePosition & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePosition"));
  pushBooleanGetter(L, "IsBattleDestroyed", session, (card) => Boolean(card && isBattleDestroyed(card)));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetBattleTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattledGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetBattledGroup"));
  pushNumberGetter(L, "GetBattledGroupCount", session, (card) => battledOpponentUids(session, card).length);
  pushNumberGetter(L, "GetAttackedCount", session, (card) => (card ? session.state.battlePairs.filter((pair) => pair.attackerUid === card.uid).length : 0));
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

function pushBattleTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const attack = session.state.currentAttack ?? session.state.pendingBattle;
  const targetUid = attack && card?.uid === attack.attackerUid ? attack.targetUid : attack && card?.uid === attack.targetUid ? attack.attackerUid : undefined;
  if (!targetUid) lua.lua_pushnil(L);
  else pushCardTable(L, targetUid);
  return 1;
}

function pushBattledGroup(L: unknown, session: DuelSession): number {
  pushGroupTable(L, battledOpponentUids(session, readCard(L, session)));
  return 1;
}

function battledOpponentUids(session: DuelSession, card: DuelCardInstance | undefined): string[] {
  if (!card) return [];
  const opponents = session.state.battlePairs.flatMap((pair) => {
    if (pair.attackerUid === card.uid) return [pair.targetUid];
    if (pair.targetUid === card.uid) return [pair.attackerUid];
    return [];
  });
  return [...new Set(opponents)].filter((uid) => session.state.cards.some((candidate) => candidate.uid === uid));
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
