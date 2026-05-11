import fengari from "fengari";
import { canMoveDuelCardToLocation } from "#duel/core.js";
import { tributeUnitCount } from "#duel/double-tribute.js";
import { duelReason } from "#duel/reasons.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { readMaxTributeRequirement, readMinTributeRequirement } from "#lua/tribute-metadata-api.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };
type ReleaseCostQuery = { player: PlayerId; filterRef: number | undefined; minimum: number; maximum: number; useHand: boolean; checkRef: number | undefined; excluded: string[]; args: LuaFilterArgs };

export interface LuaDuelReleaseApiHostState {
  selectedUids: string[];
  activeLuaEffectId?: number | undefined;
  effects: ReadonlyMap<number, LuaEffectRecord>;
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installDuelReleaseApi(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushIsPlayerCanRelease(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanRelease"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetReleaseGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckTribute(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckTribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTributeCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetTributeCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTributeGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetTributeGroup"));
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
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckReleaseGroupSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroupSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectReleaseGroupSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroupSummon"));
}

function pushIsPlayerCanRelease(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const uid = readCardUid(L, 2);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  lua.lua_pushboolean(L, card ? isReleaseProbeAllowed(session, card, player) : releasableMonsterUids(L, session, undefined, player, [], { start: 3, count: 0 }).length > 0);
  return 1;
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
  const minimum = Math.max(0, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : normalSummonTributeMinimum(L, target));
  const maximum = Math.max(minimum, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : normalSummonTributeMaximum(L, target));
  const materials = readCardOrGroupUids(L, 4);
  const materialSet = materialRestrictionSet(L, 4, materials);
  const zoneMask = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : undefined;
  const candidates = tributeCandidateUids(session, player, target?.uid, materialSet);
  const selected = tributeZoneSelection(session, player, candidates, minimum, maximum, zoneMask);
  lua.lua_pushboolean(L, Boolean(target && selected && tributeUnitTotal(session, selected) >= minimum));
  return 1;
}

function pushTributeCount(L: unknown, session: DuelSession): number {
  const targetUid = readCardUid(L, 1);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  lua.lua_pushinteger(L, normalSummonTributeMinimum(L, target));
  return 1;
}

function pushTributeGroup(L: unknown, session: DuelSession): number {
  const targetUid = readCardUid(L, 1);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  const player = readOptionalPlayer(L, 2) ?? target?.controller ?? session.state.turnPlayer;
  const materials = readCardOrGroupUids(L, 3);
  const materialSet = materialRestrictionSet(L, 3, materials);
  pushGroupTable(L, tributeCandidateUids(session, player, target?.uid, materialSet));
  return 1;
}

function pushSelectTribute(L: unknown, session: DuelSession): number {
  const player = readOptionalPlayer(L, 6) ?? normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const targetUid = readCardUid(L, 2);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  const minimum = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : normalSummonTributeMinimum(L, target));
  const maximum = Math.max(minimum, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : normalSummonTributeMaximum(L, target));
  const materials = readCardOrGroupUids(L, 5);
  const materialSet = materialRestrictionSet(L, 5, materials);
  const zoneMask = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : undefined;
  const candidates = tributeCandidateUids(session, player, target?.uid, materialSet);
  const selected = tributeZoneSelection(session, player, candidates, minimum, maximum, zoneMask);
  pushGroupTable(L, selected && tributeUnitTotal(session, selected) >= minimum ? selected : []);
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
  const query = readReleaseCostQuery(L, session, false);
  const selected = selectedReleasableMonsterUids(session, query.player, query.excluded, hostState.selectedUids, query.useHand);
  const available = releasableMonsterUids(L, session, query.filterRef, query.player, [...query.excluded, ...selected], query.args, query.useHand, hostState);
  const candidate = [...selected, ...available].slice(0, query.maximum);
  releaseOptionalFunctionRef(L, query.filterRef);
  const matchesCheck = candidate.length >= query.minimum && releaseCostCheckMatches(L, query.checkRef, candidate, query.player, query.excluded, query.args);
  releaseOptionalFunctionRef(L, query.checkRef);
  const count = selected.length + available.length;
  lua.lua_pushboolean(L, count >= query.minimum && selected.length <= query.maximum && matchesCheck);
  return 1;
}

function pushSelectReleaseGroupCost(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const query = readReleaseCostQuery(L, session, true);
  const selected = selectedReleasableMonsterUids(session, query.player, query.excluded, hostState.selectedUids, query.useHand);
  const candidates = selected.length > query.maximum ? [] : [...selected, ...releasableMonsterUids(L, session, query.filterRef, query.player, [...query.excluded, ...selected], query.args, query.useHand, hostState)];
  const limit = query.maximum > 0 ? query.maximum : Math.max(query.minimum, 1);
  const uids = candidates.slice(0, limit);
  releaseOptionalFunctionRef(L, query.filterRef);
  const checked = uids.length >= query.minimum && releaseCostCheckMatches(L, query.checkRef, uids, query.player, query.excluded, query.args) ? uids : [];
  releaseOptionalFunctionRef(L, query.checkRef);
  pushGroupTable(L, checked);
  return 1;
}

function pushCheckReleaseGroupSummon(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const query = readReleaseSummonQuery(L, session, hostState);
  const candidates = releaseSummonCandidateUids(L, session, query);
  releaseOptionalFunctionRef(L, query.filterRef);
  const selected = releaseSummonSelection(session, query, candidates);
  lua.lua_pushboolean(L, selected.length >= query.minimum && availableMonsterZoneCount(session, query.player, selected) > 0);
  return 1;
}

function pushSelectReleaseGroupSummon(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): number {
  const query = readReleaseSummonQuery(L, session, hostState);
  const candidates = releaseSummonCandidateUids(L, session, query);
  releaseOptionalFunctionRef(L, query.filterRef);
  const selected = releaseSummonSelection(session, query, candidates);
  pushGroupTable(L, selected.length >= query.minimum && availableMonsterZoneCount(session, query.player, selected) > 0 ? selected : []);
  return 1;
}

function readReleaseCostQuery(L: unknown, session: DuelSession, hasMax: boolean): ReleaseCostQuery {
  const upstreamShape = !hasMax && !lua.lua_isnumber(L, 4);
  const useHandIndex = upstreamShape ? 4 : 5;
  const checkIndex = upstreamShape ? 5 : 6;
  const excludedIndex = upstreamShape ? 6 : 7;
  const minimum = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  return {
    player: normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer),
    filterRef: readOptionalFunctionRef(L, 2),
    minimum,
    maximum: hasMax || !upstreamShape ? Math.max(minimum, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : minimum) : minimum,
    useHand: lua.lua_toboolean(L, useHandIndex),
    checkRef: readOptionalFunctionRef(L, checkIndex),
    excluded: readCardOrGroupUids(L, excludedIndex),
    args: readFilterArgs(L, excludedIndex + 1),
  };
}

interface ReleaseSummonQuery {
  player: PlayerId;
  filterRef: number | undefined;
  minimum: number;
  maximum: number;
  excluded: string[];
  args: LuaFilterArgs;
  selected: string[];
}

function readReleaseSummonQuery(L: unknown, session: DuelSession, hostState: LuaDuelReleaseApiHostState): ReleaseSummonQuery {
  const player = normalizePlayer(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : session.state.turnPlayer);
  const minimum = Math.max(0, lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1);
  const maximum = Math.max(minimum, lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : minimum);
  const lastIndex = 7;
  const excludedIndex = lua.lua_isnumber(L, lastIndex) ? lastIndex + 1 : lastIndex;
  const excluded = readCardOrGroupUids(L, excludedIndex);
  return {
    player,
    filterRef: readOptionalFunctionRef(L, 4),
    minimum,
    maximum,
    excluded,
    args: readFilterArgs(L, excludedIndex + 1),
    selected: selectedReleasableMonsterUids(session, player, excluded, hostState.selectedUids),
  };
}

function releaseSummonCandidateUids(L: unknown, session: DuelSession, query: ReleaseSummonQuery): string[] {
  return [
    ...query.selected,
    ...releasableMonsterUids(L, session, query.filterRef, query.player, [...query.excluded, ...query.selected], query.args),
  ];
}

function releaseSummonSelection(session: DuelSession, query: ReleaseSummonQuery, candidates: string[]): string[] {
  if (query.selected.length > query.maximum || candidates.length < query.minimum) return [];
  const limit = query.maximum > 0 ? query.maximum : Math.max(query.minimum, 1);
  for (let count = Math.max(query.minimum, query.selected.length); count <= Math.min(limit, candidates.length); count += 1) {
    const selected = candidates.slice(0, count);
    if (availableMonsterZoneCount(session, query.player, selected) > 0) return selected;
  }
  return [];
}

function releaseCostCheckMatches(L: unknown, checkRef: number | undefined, uids: string[], player: PlayerId, excluded: string[], args: LuaFilterArgs): boolean {
  if (checkRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, checkRef);
  pushGroupTable(L, uids);
  lua.lua_pushinteger(L, player);
  pushGroupTable(L, excluded);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 3 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
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

function releasableMonsterUids(L: unknown, session: DuelSession, filterRef: number | undefined, player: PlayerId, excluded: string[], args: LuaFilterArgs, includeHand = false, hostState?: LuaDuelReleaseApiHostState): string[] {
  return session.state.cards
    .filter((card) => isReleasableMonster(L, session, card, player, excluded, includeHand, hostState))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid)
    .filter((uid) => cardMatchesFilter(L, uid, filterRef, args));
}

function isReleasableMonster(L: unknown, session: DuelSession, card: DuelCardInstance, player: PlayerId, excluded: string[], includeHand = false, hostState?: LuaDuelReleaseApiHostState): boolean {
  if (excluded.includes(card.uid)) return false;
  const extraRelease = extraReleaseNonsumApplies(L, session, card, player, hostState);
  if ((!extraRelease && card.controller !== player) || (card.location !== "monsterZone" && (!includeHand || card.location !== "hand") && !extraRelease)) return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return canMoveDuelCardToLocation(session.state, card.uid, "graveyard", duelReason.release | duelReason.cost);
}

function extraReleaseNonsumApplies(L: unknown, session: DuelSession, card: DuelCardInstance, player: PlayerId, hostState: LuaDuelReleaseApiHostState | undefined): boolean {
  if (!L || !hostState) return false;
  return (
    matchingLuaEffects(session.state, card, 158, hostState).some((effect) => luaEffectCountLimitAvailable(L, hostState, effect, player) && luaExtraReleaseValueApplies(L, hostState, effect, player)) ||
    restoredExtraReleaseNonsumApplies(session, card, player, hostState)
  );
}

function restoredExtraReleaseNonsumApplies(session: DuelSession, card: DuelCardInstance, player: PlayerId, hostState: LuaDuelReleaseApiHostState): boolean {
  if (card.controller !== player || card.location !== "extraDeck") return false;
  const active = hostState.activeLuaEffectId === undefined ? undefined : session.state.effects.find((effect) => effect.id === `lua-${hostState.activeLuaEffectId}` || effect.id.startsWith(`lua-${hostState.activeLuaEffectId}-`));
  const handler = active ? session.state.cards.find((candidate) => candidate.uid === active.sourceUid) : undefined;
  if (handler?.code !== "80280737") return false;
  return session.state.effects.some((effect) => effect.code === 158 && effect.controller === player && effect.targetRange?.[0] === 0x40 && effect.sourceUid !== undefined);
}

function luaEffectCountLimitAvailable(L: unknown, hostState: LuaDuelReleaseApiHostState, effect: LuaEffectRecord, player: PlayerId): boolean {
  hostState.pushEffectTable(L, effect.id);
  lua.lua_getfield(L, -1, to_luastring("CheckCountLimit"));
  lua.lua_pushvalue(L, -2);
  lua.lua_pushinteger(L, player);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) { lua.lua_pop(L, 2); return false; }
  const result = Boolean(lua.lua_toboolean(L, -1));
  lua.lua_pop(L, 2);
  return result;
}

function luaExtraReleaseValueApplies(L: unknown, hostState: LuaDuelReleaseApiHostState, effect: LuaEffectRecord, player: PlayerId): boolean {
  if (effect.value !== undefined) return effect.value !== 0;
  if (effect.valueRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
  hostState.pushEffectTable(L, effect.id);
  if (hostState.activeLuaEffectId !== undefined) hostState.pushEffectTable(L, hostState.activeLuaEffectId);
  else lua.lua_pushnil(L);
  lua.lua_pushinteger(L, duelReason.cost);
  lua.lua_pushinteger(L, player);
  const status = lua.lua_pcall(L, 4, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = Boolean(lua.lua_toboolean(L, -1));
  lua.lua_pop(L, 1);
  return result;
}

function isReleaseProbeAllowed(session: DuelSession, card: DuelCardInstance, player: PlayerId): boolean {
  if (card.controller !== player) return false;
  if (card.location !== "monsterZone" && card.location !== "banished") return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return canMoveDuelCardToLocation(session.state, card.uid, "graveyard", duelReason.release | duelReason.cost);
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

function materialRestrictionSet(L: unknown, index: number, materials: string[]): Set<string> | undefined {
  return lua.lua_isnoneornil(L, index) ? undefined : new Set(materials);
}

function tributeZoneSelection(session: DuelSession, player: PlayerId, candidates: string[], minimum: number, maximum: number, zoneMask: number | undefined): string[] | undefined {
  for (const selected of tributeSelections(session, candidates, minimum, maximum)) {
    if (hasAvailableTributeSummonZone(session, player, selected, zoneMask)) return selected;
  }
  return undefined;
}

function tributeSelections(session: DuelSession, candidates: string[], minimum: number, maximum: number): string[][] {
  if (minimum === 0) return [[]];
  const results: string[][] = [];
  const limit = maximum > 0 ? maximum : minimum;
  for (let index = 0; index < candidates.length; index += 1) {
    const uid = candidates[index];
    if (!uid) continue;
    const units = tributeUnitTotal(session, [uid]);
    if (units > limit) continue;
    if (units >= minimum) results.push([uid]);
    for (const tail of tributeSelections(session, candidates.slice(index + 1), Math.max(0, minimum - units), limit - units)) {
      results.push([uid, ...tail]);
    }
  }
  return results;
}

function tributeUnitTotal(session: DuelSession, uids: string[]): number {
  return uids.reduce((sum, uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return sum + (card ? tributeUnitCount(session.state, card) : 0);
  }, 0);
}

function hasAvailableTributeSummonZone(session: DuelSession, player: PlayerId, selectedUids: string[], zoneMask: number | undefined): boolean {
  const selected = new Set(selectedUids);
  const occupied = new Set(
    session.state.cards
      .filter((card) => card.controller === player && card.location === "monsterZone" && !selected.has(card.uid))
      .map((card) => card.sequence),
  );
  if (zoneMask === undefined || zoneMask === 0) return occupied.size < monsterZoneCapacity(session, player);
  for (let sequence = 0; sequence < monsterZoneCapacity(session, player); sequence += 1) {
    if ((zoneMask & (1 << sequence)) !== 0 && !occupied.has(sequence)) return true;
  }
  return false;
}

function selectedReleasableMonsterUids(session: DuelSession, player: PlayerId, excluded: string[], selectedUids: string[], includeHand = false): string[] {
  return uniqueUids(selectedUids).filter((uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return Boolean(card && isReleasableMonster(undefined, session, card, player, excluded, includeHand));
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

function normalSummonTributeMinimum(L: unknown, card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  const metadata = readMinTributeRequirement(L, card);
  return metadata ?? normalSummonTributeCount(card);
}

function normalSummonTributeMaximum(L: unknown, card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  const metadata = readMaxTributeRequirement(L, card);
  return metadata ?? normalSummonTributeCount(card);
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
