import fengari from "fengari";
import { canMoveDuelCardToLocation } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelReleaseApiHostState {
  selectedUids: string[];
}

export function installDuelReleaseApi(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroup(state, session, hostState, false));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroup(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroup(state, session, hostState, true));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroupEx"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroup(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroupEx"));
}

function pushCheckReleaseGroup(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState, hasMax: boolean): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const minimum = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const maximum = hasMax && lua.lua_isnumber(L, 4) ? Math.max(0, lua.lua_tointeger(L, 4)) : undefined;
  const excludedIndex = hasMax ? 5 : 4;
  const excluded = readCardOrGroupUids(L, excludedIndex);
  const selected = selectedReleasableMonsterUids(session, player, excluded, hostState.selectedUids);
  const count = selected.length + releasableMonsterUids(L, session, filterRef, player, [...excluded, ...selected], readFilterArgs(L, excludedIndex + 1)).length;
  releaseOptionalFunctionRef(L, filterRef);
  lua.lua_pushboolean(L, count >= minimum && (maximum === undefined || selected.length <= maximum));
  return 1;
}

function pushSelectReleaseGroup(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const min = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const max = Math.max(min, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min);
  const excluded = readCardOrGroupUids(L, 5);
  const selected = selectedReleasableMonsterUids(session, player, excluded, hostState.selectedUids);
  const uids = selected.length > max ? [] : [...selected, ...releasableMonsterUids(L, session, filterRef, player, [...excluded, ...selected], readFilterArgs(L, 6))];
  releaseOptionalFunctionRef(L, filterRef);
  pushGroupTable(L, uids.slice(0, max > 0 ? max : Math.max(min, 1)));
  return 1;
}

function releasableMonsterUids(L: unknown, session: DuelSession, filterRef: number | undefined, player: PlayerId, excluded: string[], args: LuaFilterArgs): string[] {
  return session.state.cards
    .filter((card) => isReleasableMonster(session, card, player, excluded))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid)
    .filter((uid) => cardMatchesFilter(L, uid, filterRef, args));
}

function isReleasableMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, excluded: string[]): boolean {
  if (excluded.includes(card.uid)) return false;
  if (card.controller !== player || card.location !== "monsterZone") return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return canMoveDuelCardToLocation(session.state, card.uid, "graveyard");
}

function selectedReleasableMonsterUids(session: DuelSession, player: PlayerId, excluded: string[], selectedUids: string[]): string[] {
  return uniqueUids(selectedUids).filter((uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return Boolean(card && isReleasableMonster(session, card, player, excluded));
  });
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  if (cardUid) return [cardUid];
  return readGroupUids(L, index);
}

function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  return { start, count: Math.max(0, lua.lua_gettop(L) - start + 1) };
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
