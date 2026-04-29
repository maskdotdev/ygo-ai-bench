import fengari from "fengari";
import { canMoveDuelCardToLocation, canSpecialSummonDuelCard } from "./duel-core.js";
import { findCard } from "./duel-card-state.js";
import { availableMonsterZoneCount } from "./lua-duel-location-api.js";
import { positionFromMask, readCardUid, readGroupUids } from "./lua-api-utils.js";
import type { DuelLocation, DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export function installDuelPlayerApi(L: unknown, session: DuelSession): void {
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoGrave", session, "graveyard");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoHand", session, "hand");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoDeck", session, "deck");
  pushPlayerMoveMatcher(L, "IsPlayerCanRemove", session, "banished");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoExtra", session, "extraDeck");
  lua.lua_pushcfunction(L, (state: unknown) => pushCanNormalSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanNormalSet(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanMSet"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummon"));
}

function pushCanNormalSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const uid = readCardUid(L, 2);
  const ignoreCount = lua.lua_toboolean(L, 3);
  lua.lua_pushboolean(L, canNormalSummon(session, player, uid, ignoreCount));
  return 1;
}

function pushCanNormalSet(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const uid = readCardUid(L, 2);
  const ignoreCount = lua.lua_toboolean(L, 3);
  lua.lua_pushboolean(L, canNormalSet(session, player, uid, ignoreCount));
  return 1;
}

function pushCanSpecialSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const positionMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0x1;
  const targetPlayer = normalizePlayer(lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : player);
  const uid = readCardUid(L, 5) ?? readCardUid(L, 2);
  lua.lua_pushboolean(L, canSpecialSummon(session, player, targetPlayer, positionMask, uid));
  return 1;
}

function canNormalSummon(session: DuelSession, player: PlayerId, uid: string | undefined, ignoreCount: boolean): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  if (!ignoreCount && !session.state.players[player].normalSummonAvailable) return false;
  const card = uid ? findCard(session.state, uid) : undefined;
  if (card && (card.controller !== player || card.location !== "hand" || !isMonsterLike(card.kind))) return false;
  return availableMonsterZoneCount(session, player, []) > 0;
}

function canNormalSet(session: DuelSession, player: PlayerId, uid: string | undefined, ignoreCount: boolean): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  if (!ignoreCount && !session.state.players[player].normalSummonAvailable) return false;
  const card = uid ? findCard(session.state, uid) : undefined;
  if (card && (card.controller !== player || card.location !== "hand" || !isMonsterLike(card.kind))) return false;
  return availableMonsterZoneCount(session, player, []) > 0;
}

function canSpecialSummon(session: DuelSession, player: PlayerId, targetPlayer: PlayerId, positionMask: number, uid: string | undefined): boolean {
  if (!positionFromMask(positionMask)) return false;
  if (availableMonsterZoneCount(session, targetPlayer, []) <= 0) return false;
  if (!uid) return true;
  const card = findCard(session.state, uid);
  if (!card || !isMonsterLike(card.kind)) return false;
  if (card.controller !== player && card.owner !== player) return false;
  return canSpecialSummonDuelCard(session.state, uid, targetPlayer);
}

function pushPlayerMoveMatcher(L: unknown, fieldName: string, session: DuelSession, location: DuelLocation): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 2);
    lua.lua_pushboolean(state, uids.length === 0 || uids.every((uid) => canMoveDuelCardToLocation(session.state, uid, location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function isMainPhaseForPlayer(session: DuelSession, player: PlayerId): boolean {
  return session.state.turnPlayer === player && (session.state.phase === "main1" || session.state.phase === "main2");
}

function isMonsterLike(kind: string): boolean {
  return kind === "monster" || kind === "extra";
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
