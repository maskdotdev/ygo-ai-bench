import fengari from "fengari";
import { canMoveDuelCardToLocation } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
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
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetReleaseGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckTribute(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckTribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectTribute(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectTribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroup(state, session, hostState, false));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroup(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroup(state, session, hostState, true));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroupEx"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroup(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroupEx"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroupCost(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroupCost"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroupCost(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroupCost"));
}

function pushReleaseGroup(L: unknown, session: DuelSession): number {
  const query = readReleaseQuery(L, session);
  const uids = releasableMonsterUids(L, session, query.filterRef, query.player, query.excluded, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, uids);
  return 1;
}

function pushReleaseGroupCount(L: unknown, session: DuelSession): number {
  const query = readReleaseQuery(L, session);
  const count = releasableMonsterUids(L, session, query.filterRef, query.player, query.excluded, query.args).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushCheckTribute(L: unknown, session: DuelSession): number {
  const targetUid = readCardUid(L, 1);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  const player = readOptionalPlayer(L, 5) ?? target?.controller ?? session.state.turnPlayer;
  const minimum = Math.max(0, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : target ? normalSummonTributeCount(target) : 0);
  const maximum = Math.max(minimum, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : minimum);
  const materials = readCardOrGroupUids(L, 4);
  const materialSet = materials.length > 0 ? new Set(materials) : undefined;
  const available = tributeCandidateCount(session, player, target?.uid, materialSet);
  const selected = Math.min(available, maximum);
  const openZones = monsterZoneCapacity(session, player) - monsterZoneCount(session, player);
  lua.lua_pushboolean(L, Boolean(target && selected >= minimum && (openZones > 0 || selected > 0)));
  return 1;
}

function pushSelectTribute(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const targetUid = readCardUid(L, 2);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  const minimum = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : target ? normalSummonTributeCount(target) : 0);
  const maximum = Math.max(minimum, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : minimum);
  const materials = readCardOrGroupUids(L, 5);
  const materialSet = materials.length > 0 ? new Set(materials) : undefined;
  const selectionLimit = maximum > 0 ? maximum : minimum;
  const selected = selectionLimit > 0 ? tributeCandidateUids(session, player, target?.uid, materialSet).slice(0, selectionLimit) : [];
  pushGroupTable(L, selected.length >= minimum ? selected : []);
  return 1;
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

function pushCheckReleaseGroupCost(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const minimum = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const maximum = lua.lua_isnumber(L, 4) ? Math.max(minimum, lua.lua_tointeger(L, 4)) : minimum;
  const useHand = lua.lua_toboolean(L, 5);
  const excluded = readCardOrGroupUids(L, 7);
  const selected = selectedReleasableMonsterUids(session, player, excluded, hostState.selectedUids, useHand);
  const available = releasableMonsterUids(L, session, filterRef, player, [...excluded, ...selected], readFilterArgs(L, 8), useHand);
  releaseOptionalFunctionRef(L, filterRef);
  const count = selected.length + available.length;
  lua.lua_pushboolean(L, count >= minimum && selected.length <= maximum);
  return 1;
}

function pushSelectReleaseGroupCost(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const min = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const max = Math.max(min, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min);
  const useHand = lua.lua_toboolean(L, 5);
  const excluded = readCardOrGroupUids(L, 7);
  const selected = selectedReleasableMonsterUids(session, player, excluded, hostState.selectedUids, useHand);
  const uids = selected.length > max ? [] : [...selected, ...releasableMonsterUids(L, session, filterRef, player, [...excluded, ...selected], readFilterArgs(L, 8), useHand)];
  releaseOptionalFunctionRef(L, filterRef);
  pushGroupTable(L, uids.slice(0, max > 0 ? max : Math.max(min, 1)));
  return 1;
}

interface ReleaseQuery {
  player: PlayerId;
  filterRef: number | undefined;
  excluded: string[];
  args: LuaFilterArgs;
}

function readReleaseQuery(L: unknown, session: DuelSession): ReleaseQuery {
  return {
    player: normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer),
    filterRef: readOptionalFunctionRef(L, 2),
    excluded: readCardOrGroupUids(L, 3),
    args: readFilterArgs(L, 4),
  };
}

function releasableMonsterUids(L: unknown, session: DuelSession, filterRef: number | undefined, player: PlayerId, excluded: string[], args: LuaFilterArgs, includeHand = false): string[] {
  return session.state.cards
    .filter((card) => isReleasableMonster(session, card, player, excluded, includeHand))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid)
    .filter((uid) => cardMatchesFilter(L, uid, filterRef, args));
}

function isReleasableMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, excluded: string[], includeHand = false): boolean {
  if (excluded.includes(card.uid)) return false;
  if (card.controller !== player || (card.location !== "monsterZone" && (!includeHand || card.location !== "hand"))) return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return canMoveDuelCardToLocation(session.state, card.uid, "graveyard", duelReason.release | duelReason.cost);
}

function tributeCandidateCount(session: DuelSession, player: PlayerId, targetUid: string | undefined, materialSet: Set<string> | undefined): number {
  return tributeCandidateUids(session, player, targetUid, materialSet).length;
}

function tributeCandidateUids(session: DuelSession, player: PlayerId, targetUid: string | undefined, materialSet: Set<string> | undefined): string[] {
  return session.state.cards
    .filter((card) => {
      if (card.uid === targetUid) return false;
      if (materialSet && !materialSet.has(card.uid)) return false;
      if (card.controller !== player || card.location !== "monsterZone") return false;
      if (card.kind !== "monster" && card.kind !== "extra") return false;
      return canMoveDuelCardToLocation(session.state, card.uid, "graveyard", duelReason.release | duelReason.summon);
    })
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function selectedReleasableMonsterUids(session: DuelSession, player: PlayerId, excluded: string[], selectedUids: string[], includeHand = false): string[] {
  return uniqueUids(selectedUids).filter((uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return Boolean(card && isReleasableMonster(session, card, player, excluded, includeHand));
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

function monsterZoneCount(session: DuelSession, player: PlayerId): number {
  return session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone").length;
}

function monsterZoneCapacity(_session: DuelSession, _player: PlayerId): number {
  return 5;
}

function normalSummonTributeCount(card: DuelCardInstance): number {
  const level = card.data.level ?? 0;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  return normalizePlayer(lua.lua_tointeger(L, index));
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
