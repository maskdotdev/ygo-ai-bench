import fengari from "fengari";
import { moveDuelCard } from "#duel/card-state.js";
import { isEffectTargetSelectionPrevented, matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { canUseFusionSubstitute } from "#duel/fusion-substitute.js";
import { cardCombinations, selectMaterialUidsForCodes } from "#duel/summon-materials.js";
import { cardTypeFlags as instanceCardTypeFlags } from "#duel/card-stats.js";
import { cardFieldId, pushCardTable } from "#lua/card-api.js";
import { canLuaCardBeEffectTarget, createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { installDuelLocationApi } from "#lua/duel-api/location.js";
import { cardTypeFlags as cardDataTypeFlags, readCardDataByCode } from "#lua/duel-api/query-card-data.js";
import { changeTargetCard, effectiveTargetUids } from "#lua/duel-api/query-target-state.js";
import { readCardOrGroupUids, readOptionalPlayer } from "#lua/duel-api/move-readers.js";
import { pushGroupTable } from "#lua/group-api.js";
import { fusionMaterialCountAllowed, fusionMaterialMatches, fusionMaterialSelectionMatches, hasGenericFusionMaterialRequirement } from "#duel/summon.js";
import { findSubGroupSelection, findSumGreaterSelection, findSumSelection } from "#lua/group-selection-utils.js";
import { uniqueUids } from "#lua/group-uid-utils.js";
import { locationMatchesCardMask, locationsFromMask, readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord, LuaPromptDecision } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelQueryApiHostState {
  promptDecisions?: LuaPromptDecision[];
  nextPromptId?: number;
  promptBehavior?: "default" | "yield";
  activeTargetUids: string[] | undefined;
  activeLuaEffectId: number | undefined;
  activeContext: DuelEffectContext | undefined;
  effects: Map<number, LuaEffectRecord>;
  operatedUids: string[];
  selectedUids: string[];
  fusionMaterialUids: string[];
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installDuelQueryApi(L: unknown, session: DuelSession, hostState: LuaDuelQueryApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupRush"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupCountRush"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMatchingGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetMatchingTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFusionMaterial(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetFusionMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetFusionMaterial(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SetFusionMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFusionMaterial(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectFusionMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroupCountRush"));
  lua.lua_pushcfunction(L, (state: unknown) => pushOverlayGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetOverlayGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushOverlayGroupCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetOverlayCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFieldCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFieldCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCardFromCardId(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCardFromCardID"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCardTypeFromCode(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCardTypeFromCode"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCardSetcodesFromCode(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCardSetcodeFromCode"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsExistingMatchingCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsExistingMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsExistingMatchingCard(state, session, selectTargetOptions(hostState)));
  lua.lua_setfield(L, -2, to_luastring("IsExistingTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTargetCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstMatchingCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFirstMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsEnvironment(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsEnvironment"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEnvironment(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetEnvironment"));
  installDuelLocationApi(L, session, hostState);
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckWithSumEqual(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectWithSumEqual(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumEqual"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckWithSumGreater(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectWithSumGreater(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectWithSumGreater"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckSubGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckSubGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectSubGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectSubGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session, selectTargetOptions(hostState)));
  lua.lua_setfield(L, -2, to_luastring("SelectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstTarget(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetFirstTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, effectiveTargetUids(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTargetCards"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTargetGroup(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetTargetGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (hostState.activeTargetUids) hostState.activeTargetUids.splice(0, hostState.activeTargetUids.length, ...uniqueUids(readCardOrGroupUids(state, 1)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    changeTargetCard(hostState, uniqueUids(readCardOrGroupUids(state, 1)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangeTargetCard"));
  lua.lua_pushcfunction(L, () => {
    if (hostState.activeTargetUids) hostState.activeTargetUids.splice(0, hostState.activeTargetUids.length);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ClearTargetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const target = readOptionalPlayer(state, 1);
    if (target !== undefined) hostState.activeContext?.setTargetPlayer(target);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (lua.lua_isnumber(state, 1)) hostState.activeContext?.setTargetParam(lua.lua_tointeger(state, 1));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetTargetParam"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTargetPlayer(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetTargetPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTargetParam(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetTargetParam"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.operatedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperatedGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    hostState.selectedUids.splice(0, hostState.selectedUids.length, ...uniqueUids(readCardOrGroupUids(state, 1)));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetSelectedCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.selectedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetSelectedCard"));
}

function pushTargetPlayer(L: unknown, hostState: LuaDuelQueryApiHostState): number {
  const targetPlayer = hostState.activeContext?.targetPlayer;
  if (targetPlayer === undefined) lua.lua_pushnil(L);
  else lua.lua_pushinteger(L, targetPlayer);
  return 1;
}

function pushTargetParam(L: unknown, hostState: LuaDuelQueryApiHostState): number {
  const targetParam = hostState.activeContext?.targetParam;
  if (targetParam === undefined) lua.lua_pushnil(L);
  else lua.lua_pushinteger(L, targetParam);
  return 1;
}

function pushMatchingGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const uids = matchingCardUidsWithFilter(L, session, query);
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, uids);
  return 1;
}

function pushMatchingGroupCount(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const count = matchingCardUidsWithFilter(L, session, query).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushTargetGroup(L: unknown, session: DuelSession, hostState: LuaDuelQueryApiHostState): number {
  if (lua.lua_gettop(L) === 0) {
    pushGroupTable(L, effectiveTargetUids(session, hostState));
    return 1;
  }
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const uids = matchingCardUidsWithFilter(L, session, query);
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, uids);
  return 1;
}

function pushFieldGroup(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  pushGroupTable(L, fieldGroupUids(session, player, selfMask, opponentMask));
  return 1;
}

function pushFusionMaterial(L: unknown, session: DuelSession, hostState?: LuaDuelQueryApiHostState): number {
  if (hostState?.fusionMaterialUids.length) {
    pushGroupTable(L, hostState.fusionMaterialUids);
    return 1;
  }
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  pushGroupTable(
    L,
    fieldGroupUids(session, player, 0x02 | 0x04, 0)
      .filter((uid) => {
        const card = session.state.cards.find((candidate) => candidate.uid === uid);
        return Boolean(card && canUseAsFusionMaterial(session.state, card));
      }),
  );
  return 1;
}

function pushSetFusionMaterial(L: unknown, hostState: LuaDuelQueryApiHostState): number {
  hostState.fusionMaterialUids.splice(0, hostState.fusionMaterialUids.length, ...uniqueUids(readCardOrGroupUids(L, 1)));
  return 0;
}

function pushSelectedFusionMaterial(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const targetUid = readCardUid(L, 2);
  const target = targetUid ? session.state.cards.find((card) => card.uid === targetUid) : undefined;
  const suppliedUids = readGroupUids(L, 3);
  const forcedUids = readCardOrGroupUids(L, 4);
  const hasSuppliedMaterialGroup = suppliedUids.length > 0;
  const poolUids = suppliedUids.length > 0 ? suppliedUids : fieldGroupUids(session, player, 0x02 | 0x04, 0);
  const candidates = poolUids
    .map((uid) => session.state.cards.find((card) => card.uid === uid))
    .filter((card): card is DuelCardInstance => Boolean(card && card.uid !== targetUid && (hasSuppliedMaterialGroup || card.controller === player) && canUseAsFusionMaterial(session.state, card)));
  pushGroupTable(L, selectFusionMaterialUids(session, candidates, target, forcedUids));
  return 1;
}

function pushFieldGroupCount(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  lua.lua_pushinteger(L, fieldGroupUids(session, player, selfMask, opponentMask).length);
  return 1;
}

function pushOverlayGroup(L: unknown, session: DuelSession): number {
  pushGroupTable(L, overlayGroupUids(session, readOverlayQuery(L, session)));
  return 1;
}

function pushOverlayGroupCount(L: unknown, session: DuelSession): number {
  lua.lua_pushinteger(L, overlayGroupUids(session, readOverlayQuery(L, session)).length);
  return 1;
}

function readOverlayQuery(L: unknown, session: DuelSession): { player: PlayerId; self: boolean; opponent: boolean; excluded: string[] } {
  return {
    player: normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer),
    self: lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) !== 0 : lua.lua_toboolean(L, 2),
    opponent: lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) !== 0 : lua.lua_toboolean(L, 3),
    excluded: readCardOrGroupUids(L, 4),
  };
}

function overlayGroupUids(session: DuelSession, query: { player: PlayerId; self: boolean; opponent: boolean; excluded: string[] }): string[] {
  return overlaySourceCards(session, query)
    .flatMap((card) => card.overlayUids)
    .filter((uid) => !query.excluded.includes(uid));
}

function overlaySourceCards(session: DuelSession, query: { player: PlayerId; self: boolean; opponent: boolean }): { controller: PlayerId; location: DuelLocation; sequence: number; overlayUids: string[] }[] {
  const players = [query.self ? query.player : undefined, query.opponent ? otherPlayer(query.player) : undefined].filter((player): player is PlayerId => player !== undefined);
  return session.state.cards
    .filter((card) => players.includes(card.controller) && card.location === "monsterZone" && card.overlayUids.length > 0)
    .sort((a, b) => a.controller - b.controller || a.sequence - b.sequence);
}

function pushFieldCard(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const locationMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const sequence = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const card = fieldLocationMaskUsesExactSequence(locationMask)
    ? session.state.cards.find((candidate) => candidate.controller === player && candidate.sequence === sequence && locationMatchesCardMask(candidate, locationMask))
    : session.state.cards.find((candidate) => candidate.uid === matchingCardUids(session, player, locationMask)[sequence]);
  if (!card) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, card.uid);
  return 1;
}

function fieldLocationMaskUsesExactSequence(locationMask: number): boolean {
  return (locationMask & (0x04 | 0x08 | 0x100 | 0x200 | 0x400 | 0x800 | 0x1000)) !== 0;
}

function pushCardFromCardId(L: unknown, session: DuelSession): number {
  const id = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  const card = session.state.cards.find((candidate) => cardFieldId(candidate) === id);
  if (!card) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, card.uid);
  return 1;
}

function pushCardTypeFromCode(L: unknown, session: DuelSession): number {
  const data = readCardDataByCode(L, session, 1);
  lua.lua_pushinteger(L, cardDataTypeFlags(data));
  return 1;
}

function pushCardSetcodesFromCode(L: unknown, session: DuelSession): number {
  const data = readCardDataByCode(L, session, 1);
  const setcodes = data?.setcodes ?? [];
  for (const setcode of setcodes) lua.lua_pushinteger(L, setcode);
  return setcodes.length;
}

function pushIsExistingMatchingCard(L: unknown, session: DuelSession, options?: { hostState: LuaDuelQueryApiHostState }): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 6, 7);
  const minimum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1;
  const count = effectTargetableMatches(L, session, query, options?.hostState).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, count >= minimum);
  return 1;
}

function pushTargetCount(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const count = matchingCardUidsWithFilter(L, session, query).length;
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushFirstMatchingCard(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 5, 6);
  const uid = matchingCardUidsWithFilter(L, session, query)[0];
  releaseOptionalFunctionRef(L, query.filterRef);
  if (!uid) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, uid);
  return 1;
}

function pushIsEnvironment(L: unknown, session: DuelSession): number {
  const code = lua.lua_isnumber(L, 1) ? String(lua.lua_tointeger(L, 1)) : "";
  const players = environmentPlayers(L, session, 2);
  const locations = environmentLocations(L, 3);
  const active =
    players.some((player) => hasEnvironmentFieldSpell(session, player, code, locations)) ||
    players.some((player) => hasEnvironmentEffect(session, player, code));
  lua.lua_pushboolean(L, active);
  return 1;
}

function pushEnvironment(L: unknown, session: DuelSession): number {
  const players = environmentPlayers(L, session, 1);
  const locations = environmentLocations(L, 2);
  const environment = players
    .flatMap((player) => environmentFieldSpells(session, player, locations))
    .sort((left, right) => left.sequence - right.sequence)[0];
  lua.lua_pushinteger(L, environment ? Number(environment.code) || 0 : 0);
  return 1;
}

function pushSelectedMatchingGroup(L: unknown, session: DuelSession, options?: { hostState: LuaDuelQueryApiHostState; targetUids?: string[] }): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 8, 9);
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const matches = effectTargetableMatches(L, session, query, options?.hostState);
  const selected = selectMatchingUids(matches, min, max);
  releaseOptionalFunctionRef(L, query.filterRef);
  if (options?.targetUids) appendSelectedTargetUids(options.targetUids, selected);
  pushGroupTable(L, selected);
  return 1;
}

function appendSelectedTargetUids(targetUids: string[], selected: string[]): void {
  for (const uid of selected) {
    if (!targetUids.includes(uid)) targetUids.push(uid);
  }
}

function selectTargetOptions(hostState: LuaDuelQueryApiHostState): { hostState: LuaDuelQueryApiHostState; targetUids?: string[] } {
  return hostState.activeTargetUids ? { hostState, targetUids: hostState.activeTargetUids } : { hostState };
}

function effectTargetableMatches(L: unknown, session: DuelSession, query: MatchingQuery, hostState?: LuaDuelQueryApiHostState): string[] {
  const filtered = matchingCardUidsWithFilter(L, session, query);
  const targetEffect = hostState?.activeLuaEffectId === undefined ? undefined : hostState.effects.get(hostState.activeLuaEffectId);
  if (!hostState || !targetEffect) return filtered;
  return filtered.filter((uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return (
      canLuaCardBeEffectTarget(L, session, hostState, card, targetEffect) &&
      Boolean(card && !isEffectTargetSelectionPrevented(session.state, query.player, card, createLuaMaterialCheckContext(session.state)))
    );
  });
}

function pushCheckWithSumEqual(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 8, 9);
  const sum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const selected = selectUidsWithSum(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushCheckWithSumGreater(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 8, 9);
  const sum = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const selected = selectUidsWithSumGreater(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushSelectWithSumEqual(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 9, 10);
  const sum = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0;
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectUidsWithSum(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushSelectWithSumGreater(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 3, 4, 5, 9, 10);
  const sum = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0;
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectUidsWithSumGreater(L, matchingCardUidsForQuery(session, query), query.filterRef, sum, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushCheckSubGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 1, 2, 3, 4, 7, 8);
  const min = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1;
  const max = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : min;
  const selected = selectSubGroup(L, matchingCardUidsForQuery(session, query), query.filterRef, min, max, query.args);
  releaseOptionalFunctionRef(L, query.filterRef);
  lua.lua_pushboolean(L, selected !== undefined);
  return 1;
}

function pushSelectSubGroup(L: unknown, session: DuelSession): number {
  const query = readMatchingQuery(L, session, 2, 4, 5, 6, 9, 10);
  const min = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 1;
  const max = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : min;
  const selected = selectSubGroup(L, matchingCardUidsForQuery(session, query), query.filterRef, min, max, query.args) ?? [];
  releaseOptionalFunctionRef(L, query.filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function pushFirstTarget(L: unknown, session: DuelSession, hostState: LuaDuelQueryApiHostState): number {
  const target = effectiveTargetUids(session, hostState)[0];
  if (!target) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, target);
  return 1;
}

function readMatchingQuery(L: unknown, session: DuelSession, filterIndex: number, playerIndex: number, selfIndex: number, opponentIndex: number, excludedIndex: number, argsIndex: number): MatchingQuery {
  return {
    filterRef: readOptionalFunctionRef(L, filterIndex),
    player: normalizePlayer(lua.lua_isnumber(L, playerIndex) ? lua.lua_tointeger(L, playerIndex) : session.state.turnPlayer),
    selfMask: lua.lua_isnumber(L, selfIndex) ? lua.lua_tointeger(L, selfIndex) : 0,
    opponentMask: lua.lua_isnumber(L, opponentIndex) ? lua.lua_tointeger(L, opponentIndex) : 0,
    excluded: readCardOrGroupUids(L, excludedIndex),
    args: readFilterArgs(L, argsIndex),
  };
}

interface MatchingQuery {
  filterRef: number | undefined;
  player: PlayerId;
  selfMask: number;
  opponentMask: number;
  excluded: string[];
  args: LuaFilterArgs;
}

function matchingCardUidsWithFilter(L: unknown, session: DuelSession, query: MatchingQuery): string[] {
  return matchingCardUidsForQuery(session, query).filter((uid) => cardMatchesFilter(L, uid, query.filterRef, query.args));
}

function matchingCardUidsForQuery(session: DuelSession, query: MatchingQuery): string[] {
  return fieldGroupUids(session, query.player, query.selfMask, query.opponentMask).filter((uid) => !query.excluded.includes(uid));
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function selectMatchingUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function cardFilterNumberValue(L: unknown, uid: string, filterRef: number, args: LuaFilterArgs): number | undefined {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : lua.lua_toboolean(L, -1) ? 1 : 0;
  lua.lua_pop(L, 1);
  return result;
}

function selectUidsWithSum(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: cardFilterNumberValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  return findSumSelection(entries, sum, boundedMin, boundedMax, 0, [], 0);
}

function selectUidsWithSumGreater(L: unknown, uids: string[], filterRef: number | undefined, sum: number, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  const entries = uids
    .map((uid) => ({ uid, value: cardFilterNumberValue(L, uid, filterRef, args) }))
    .filter((entry): entry is { uid: string; value: number } => entry.value !== undefined);
  return findSumGreaterSelection(entries, sum, boundedMin, boundedMax, 0, [], 0);
}

function selectSubGroup(L: unknown, uids: string[], filterRef: number | undefined, min: number, max: number, args: LuaFilterArgs): string[] | undefined {
  if (filterRef === undefined) return undefined;
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findSubGroupSelection(uids, boundedMin, boundedMax, (selected) => groupPredicateMatches(L, selected, filterRef, args), 0, []);
}

function groupPredicateMatches(L: unknown, uids: string[], filterRef: number, args: LuaFilterArgs): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushGroupTable(L, uids);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  return { start, count: Math.max(0, lua.lua_gettop(L) - start + 1) };
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function environmentPlayers(L: unknown, session: DuelSession, index: number): PlayerId[] {
  if (!lua.lua_isnumber(L, index)) return [session.state.turnPlayer, otherPlayer(session.state.turnPlayer)];
  const value = lua.lua_tointeger(L, index);
  if (value === 0 || value === 1) return [value];
  return [0, 1];
}

function environmentLocations(L: unknown, index: number): DuelLocation[] {
  if (!lua.lua_isnumber(L, index)) return ["spellTrapZone"];
  const mask = lua.lua_tointeger(L, index);
  if ((mask & 0x100) !== 0) return ["spellTrapZone"];
  return locationsFromMask(mask);
}

function hasEnvironmentFieldSpell(session: DuelSession, player: PlayerId, code: string, locations: DuelLocation[]): boolean {
  return environmentFieldSpells(session, player, locations).some((card) => card.code === code);
}

function environmentFieldSpells(session: DuelSession, player: PlayerId, locations: DuelLocation[]): DuelCardInstance[] {
  return session.state.cards.filter(
    (card) =>
      card.controller === player &&
      card.faceUp &&
      locations.includes(card.location) &&
      (card.data.typeFlags ?? 0) !== 0 &&
      ((card.data.typeFlags ?? 0) & 0x80000) !== 0,
  );
}

function hasEnvironmentEffect(session: DuelSession, player: PlayerId, code: string): boolean {
  return matchingPlayerEffects(session.state, player, 290, createEnvironmentCheckContext(session)).some((match) => String(match.effect.value ?? "") === code);
}

function createEnvironmentCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && locationMatchesCardMask(card, locationMask))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function selectFusionMaterialUids(session: DuelSession, candidates: DuelCardInstance[], target: DuelCardInstance | undefined, forcedUids: string[] = []): string[] {
  const uniqueForcedUids = uniqueUids(forcedUids);
  const forced = uniqueForcedUids
    .map((uid) => candidates.find((card) => card.uid === uid))
    .filter((card): card is DuelCardInstance => card !== undefined);
  if (forced.length !== uniqueForcedUids.length) return [];
  const requiredCodes = target?.data.fusionMaterials ?? [];
  const requiredCount = requiredCodes.length + (target?.data.fusionRequiredMaterialSetcodes?.length ?? 0) + (target?.data.fusionRequiredMaterialPredicates?.length ?? 0);
  if (target && hasGenericFusionMaterialRequirement(target)) {
    if (requiredCount > 0) {
      for (let count = Math.max(requiredCount + (target.data.fusionMaterialMin ?? 1), forced.length); count <= candidates.length; count += 1) {
        for (const materials of cardCombinations(candidates, count)) {
          if (forced.length && !forced.every((material) => materials.includes(material))) continue;
          if (fusionMaterialSelectionMatches(session.state, target, materials)) return materials.map((material) => material.uid);
        }
      }
      return [];
    }
    if (!forced.every((material) => fusionMaterialMatches(session.state, target, material))) return [];
    const matchingCandidates = candidates.filter((card) => fusionMaterialMatches(session.state, target, card));
    const selected = [...forced];
    const desiredCount = Math.min(Math.max(target.data.fusionMaterialMin ?? 1, selected.length), matchingCandidates.length, target.data.fusionMaterialMax ?? matchingCandidates.length);
    if (!fusionMaterialCountAllowed(target, desiredCount)) return [];
    for (const candidate of matchingCandidates) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= desiredCount) break;
    }
    return fusionMaterialCountAllowed(target, selected.length) ? selected.map((card) => card.uid) : [];
  }
  if (target && requiredCount !== requiredCodes.length) {
    for (const materials of cardCombinations(candidates, Math.max(requiredCount, forced.length))) {
      if (forced.length && !forced.every((material) => materials.includes(material))) continue;
      if (fusionMaterialSelectionMatches(session.state, target, materials)) return materials.map((material) => material.uid);
    }
    return [];
  }
  if (!requiredCodes.length) {
    const selected = [...forced];
    const desiredCount = Math.min(Math.max(2, selected.length), candidates.length);
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= desiredCount) break;
    }
    return selected.map((card) => card.uid);
  }
  const orderedCandidates = [...forced, ...candidates.filter((card) => !forced.includes(card))];
  return (
    selectMaterialUidsForCodes(orderedCandidates, requiredCodes, {
      maxSubstitutes: 1,
      requiredUids: uniqueForcedUids,
      matchesCode: (card, code) => currentCardMatchesCode(card, session.state, code),
      canSubstitute: (card, code) => Boolean(target && !currentCardMatchesCode(card, session.state, code) && canUseFusionSubstitute(session.state, card, target)),
    }) ?? []
  );
}

function canUseAsFusionMaterial(state: DuelState, card: DuelCardInstance): boolean {
  return isFusionMaterialLocation(card.location) && isMonsterLike(state, card);
}

function isFusionMaterialLocation(location: DuelLocation): boolean {
  return location === "hand" || location === "monsterZone" || location === "graveyard" || location === "banished" || location === "deck" || location === "extraDeck" || location === "spellTrapZone";
}

function isMonsterLike(state: DuelState, card: DuelCardInstance): boolean {
  return (instanceCardTypeFlags(card, state) & 0x1) !== 0;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
