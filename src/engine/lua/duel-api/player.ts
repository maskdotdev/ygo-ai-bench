import fengari from "fengari";
import { canMoveDuelCardToLocation, canPlayerSpecialSummon, canSpecialSummonDuelCard, collectDuelGroupedTriggerEffects } from "#duel/core.js";
import { findCard, hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { luaSpecialSummonTypeCode, luaSummonTypePendulum } from "#duel/summon-type-codes.js";
import {
  isMonsterSetPrevented,
  isNormalSummonPrevented,
  isSpellTrapSetPrevented,
  matchingPlayerEffects,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import { canRemoveDuelCounters, getDuelCardCounter, removeDuelCardCounter, removeDuelCounters } from "#duel/counters.js";
import { getDuelFlagEffectCount } from "#duel/flags.js";
import { hasPendulumSummonAvailable } from "#duel/pendulum-availability.js";
import { duelReason } from "#duel/reasons.js";
import { normalSummonActions, tributeSummonActions } from "#duel/summon.js";
import { hasActiveExtraNormalSummonCountEffect, hasAdditionalNormalSummonCountAvailable } from "#duel/extra-normal-summon.js";
import { maxSimultaneousSpecialSummonCount } from "#duel/special-summon-count.js";
import { cardTypeFlags, currentCardHasEffect, currentLeftScale, currentLevel, currentRightScale } from "#duel/card-stats.js";
import { pendulumAnyLevelScaleEffectCode, pendulumLevelBypassEffectCode } from "#duel/pendulum-effect-codes.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import { locationsFromMask, positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import { canLuaCardAddCounter } from "#lua/card-counter-api.js";
import { isNoTributePlayerAffected } from "#lua/no-tribute-api.js";
import { readMinTributeRequirement, withLuaMinTributeOverride } from "#lua/tribute-metadata-api.js";
import type { LuaEffectRecord } from "#lua/host-types.js";
import type { DuelCardData, DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const cardAdvanceCode = 52112003;
const luaSummonTypeNormal = 0x10000000;
const luaSummonTypeTribute = 0x11000000;

interface PendulumScaleInfo {
  anyLevelCandidateAllowed: boolean;
  highScale: number;
  lowScale: number;
}

export interface LuaDuelPlayerApiHostState extends LuaOperationTimingBoundaryHostState, LuaMoveImmunityHostState<LuaEffectRecord> {
  operatedUids?: string[];
  activeLuaEffectId?: number | undefined;
}

export function installDuelPlayerApi(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): void {
  lua.lua_pushcfunction(L, pushGetPlayersCount);
  lua.lua_setfield(L, -2, to_luastring("GetPlayersCount"));
  lua.lua_pushcfunction(L, pushTagSwap);
  lua.lua_setfield(L, -2, to_luastring("TagSwap"));
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoGrave", session, "graveyard");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoHand", session, "hand");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoDeck", session, "deck");
  pushPlayerMoveMatcher(L, "IsPlayerCanRemove", session, "banished");
  pushPlayerMoveMatcher(L, "IsPlayerCanSendtoExtra", session, "extraDeck");
  lua.lua_pushcfunction(L, (state: unknown) => pushCanNormalSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanAdditionalSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanAdditionalSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanAdditionalTributeSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanAdditionalTributeSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanNormalSet(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanMSet"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSetSpellTrap(state, session));
  lua.lua_setfield(L, -2, to_luastring("CanPlayerSetSpellTrap"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummonCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummonCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanPendulumSummon(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanPendulumSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummonMonster(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummonMonster"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsPlayerAffectedByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerAffectedByEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsPlayerAffectedByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetPlayerEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanRemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanAddCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsCanAddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCounter"));
}

function pushGetPlayersCount(L: unknown): number {
  lua.lua_pushinteger(L, 1);
  return 1;
}

function pushTagSwap(): number {
  return 0;
}

function pushCanNormalSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const summonType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const cardArgIndex = lua.lua_isnumber(L, 2) ? 3 : 2;
  const uid = readCardUid(L, cardArgIndex);
  const ignoreCount = lua.lua_toboolean(L, cardArgIndex + 1);
  const card = uid ? findCard(session.state, uid) : undefined;
  lua.lua_pushboolean(L, canNormalSummon(session, player, card, ignoreCount, readMinTributeRequirement(L, card), summonType));
  return 1;
}

function pushCanAdditionalSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  lua.lua_pushboolean(L, canAdditionalSummon(session, player));
  return 1;
}

function pushCanAdditionalTributeSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  lua.lua_pushboolean(L, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, cardAdvanceCode) === 0);
  return 1;
}

function pushCanNormalSet(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const uid = readCardUid(L, 2);
  const ignoreCount = lua.lua_toboolean(L, 3);
  lua.lua_pushboolean(L, canNormalSet(session, player, uid, ignoreCount));
  return 1;
}

function pushCanSetSpellTrap(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const uid = readCardUid(L, 2);
  const card = uid ? findCard(session.state, uid) : undefined;
  lua.lua_pushboolean(L, hasZoneSpace(session.state, player, "spellTrapZone") && (!card || (canSetAsSpellTrap(card) && !isSpellTrapSetPrevented(session.state, player, card, createPlayerCheckContext(session)))));
  return 1;
}

function pushCanSpecialSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const summonType = luaSpecialSummonTypeCode(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0);
  const positionMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0x1;
  const targetPlayer = normalizePlayer(lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : player);
  const uid = readCardUid(L, 5) ?? readCardUid(L, 2);
  lua.lua_pushboolean(L, canSpecialSummon(session, player, targetPlayer, positionMask, uid, summonType));
  return 1;
}

function canSetAsSpellTrap(card: DuelCardInstance): boolean {
  return card.kind === "spell" || card.kind === "trap" || (card.location === "monsterZone" && ((card.data.typeFlags ?? 0) & 0x4) !== 0);
}

function pushCanSpecialSummonCount(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const count = Math.max(0, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1);
  lua.lua_pushboolean(L, canSpecialSummonCount(session, player, count));
  return 1;
}

function pushCanPendulumSummon(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  lua.lua_pushboolean(L, canPendulumSummon(session, player));
  return 1;
}

function pushCanSpecialSummonMonster(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const playerOrSummonType = lua.lua_isnumber(L, 11) ? lua.lua_tointeger(L, 11) : undefined;
  const targetPlayer = normalizePlayer(playerOrSummonType === 0 || playerOrSummonType === 1 ? playerOrSummonType : player);
  const positionMask = lua.lua_isnumber(L, 10) ? lua.lua_tointeger(L, 10) : 0x1;
  const summonType = luaSpecialSummonTypeCode(lua.lua_isnumber(L, 12) ? lua.lua_tointeger(L, 12) : playerOrSummonType !== undefined && playerOrSummonType !== 0 && playerOrSummonType !== 1 ? playerOrSummonType : 0);
  const card = syntheticSpecialSummonCard(L, targetPlayer);
  const position = positionFromMask(positionMask);
  lua.lua_pushboolean(L, Boolean(position) && availableMonsterZoneCount(session, targetPlayer, []) > 0 && canPlayerSpecialSummon(session.state, targetPlayer, card, summonType, activeRelatedEffectId(hostState), position));
  return 1;
}

function activeRelatedEffectId(hostState: LuaDuelPlayerApiHostState): number | undefined {
  if (hostState.activeContext?.relatedEffectId !== undefined) return hostState.activeContext.relatedEffectId;
  if (hostState.activeLuaEffectId !== undefined) return hostState.activeLuaEffectId;
  const effectId = Number(hostState.activeContext?.chainLink?.effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(effectId) ? effectId : undefined;
}

function pushIsPlayerAffectedByEffect(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const code = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const matches = matchingPlayerEffects(session.state, player, code, createPlayerCheckContext(session));
  if (matches.length === 0) {
    lua.lua_pushnil(L);
    return 1;
  }
  let pushed = 0;
  for (const match of matches) {
    const effectId = luaEffectId(match.effect);
    if (effectId === undefined) continue;
    hostState.pushEffectTable(L, effectId);
    pushed += 1;
  }
  if (pushed === 0) {
    lua.lua_pushnil(L);
    return 1;
  }
  return pushed;
}

function pushIsCanRemoveCounter(L: unknown, session: DuelSession): number {
  const query = readCounterQuery(L, session);
  lua.lua_pushboolean(L, canRemoveDuelCounters(session.state, query.player, query.selfLocations, query.opponentLocations, query.counterType, query.count));
  return 1;
}

function pushIsCanAddCounter(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const uids = readCardOrGroupUids(L, 4);
  const cards =
    uids.length > 0
      ? uids.map((uid) => findCard(session.state, uid)).filter((card): card is DuelCardInstance => card !== undefined)
      : session.state.cards.filter((card) => card.controller === player && (card.location === "monsterZone" || card.location === "spellTrapZone"));
  lua.lua_pushboolean(L, cards.some((card) => canLuaCardAddCounter(L, session, hostState, card, counterType, count, false, counterCheckLocationMask(session, card))));
  return 1;
}

function counterCheckLocationMask(session: DuelSession, card: DuelCardInstance): number {
  if (card.location === "monsterZone" || card.location === "spellTrapZone") return 0;
  return card.kind === "monster" || card.kind === "extra" || (cardTypeFlags(card, session.state) & 0x1) !== 0 ? 0x04 : 0x08;
}

function pushRemoveCounter(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): number {
  if (session.state.status === "ended") {
    hostState.operatedUids?.splice(0, hostState.operatedUids.length);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const query = readCounterQuery(L, session);
  const removed = removeLuaDuelCounters(L, session, hostState, query);
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, ...removed);
  if (removed.length > 0) markLuaOperationTimingBoundary(session, hostState);
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const eventCards = removed.map((uid) => findCard(session.state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
  if (eventCards.length > 0) collectDuelGroupedTriggerEffects(session.state, "counterRemoved", eventCards, luaEffectReasonPayload(hostState, query.reason, reasonPlayer));
  if (removed.length > 0 && hostState.activeContext) hostState.activeOperationMoved = true;
  lua.lua_pushinteger(L, removed.length > 0 ? query.count : 0);
  return 1;
}

function removeLuaDuelCounters(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState, query: CounterQuery): string[] {
  if ((query.reason & duelReason.effect) === 0) return removeDuelCounters(session.state, query.player, query.selfLocations, query.opponentLocations, query.counterType, query.count);
  let remaining = query.count;
  const cards = session.state.cards
    .filter((card) => isCounterLocationIncluded(card, query.player, query.selfLocations, query.opponentLocations))
    .filter((card) => getDuelCardCounter(card, query.counterType) > 0)
    .filter((card) => !luaMoveBlockedByImmunity(L, session, hostState, card, query.reason));
  if (remaining <= 0 || cards.reduce((total, card) => total + getDuelCardCounter(card, query.counterType), 0) < remaining) return [];
  const removed: string[] = [];
  for (const card of cards) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, getDuelCardCounter(card, query.counterType));
    if (removeDuelCardCounter(findCard(session.state, card.uid), query.counterType, amount)) {
      removed.push(card.uid);
      remaining -= amount;
    }
  }
  return remaining === 0 ? removed : [];
}

function pushGetCounter(L: unknown, session: DuelSession): number {
  const query = readCounterQuery(L, session);
  const total = session.state.cards
    .filter((card) => isCounterLocationIncluded(card, query.player, query.selfLocations, query.opponentLocations))
    .reduce((sum, card) => sum + getDuelCardCounter(card, query.counterType), 0);
  lua.lua_pushinteger(L, total);
  return 1;
}

function canNormalSummon(session: DuelSession, player: PlayerId, card: DuelCardInstance | undefined, ignoreCount: boolean, minTributes: number | undefined, summonType: number | undefined): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  if (card && (card.controller !== player || card.location !== "hand" || !isMonsterLike(card.kind))) return false;
  return normalSummonAvailability(session, player, card, ignoreCount, minTributes, summonType);
}

function canAdditionalSummon(session: DuelSession, player: PlayerId): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  if (availableMonsterZoneCount(session, player, []) <= 0) return false;
  return hasAdditionalNormalSummonCountAvailable(session.state, player) && !hasActiveExtraNormalSummonCountEffect(session.state, player);
}

function canNormalSet(session: DuelSession, player: PlayerId, uid: string | undefined, ignoreCount: boolean): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  const card = uid ? findCard(session.state, uid) : undefined;
  if (card && (card.controller !== player || card.location !== "hand" || !isMonsterLike(card.kind))) return false;
  const readAvailable = (): boolean => {
    const hand = card ? [card] : session.state.cards.filter((candidate) => candidate.controller === player && candidate.location === "hand" && isMonsterLike(candidate.kind));
    const actions = [...normalSummonActions(session.state, player, hand), ...tributeSummonActions(session.state, player, hand)];
    const available = actions.filter((action) => {
      const target = "uid" in action ? findCard(session.state, action.uid) : undefined;
      return Boolean(target && (action.type === "setMonster" || action.type === "tributeSummon") && !isMonsterSetPrevented(session.state, player, target, createPlayerCheckContext(session)));
    });
    return card ? available.some((action) => actionHasUid(action, card.uid)) : available.length > 0;
  };
  if (!ignoreCount) return readAvailable();
  const previous = session.state.players[player].normalSummonAvailable;
  session.state.players[player].normalSummonAvailable = true;
  try {
    return readAvailable();
  } finally {
    session.state.players[player].normalSummonAvailable = previous;
  }
}

function normalSummonAvailability(session: DuelSession, player: PlayerId, card: DuelCardInstance | undefined, ignoreCount: boolean, minTributes: number | undefined, summonType: number | undefined): boolean {
  const readAvailable = (): boolean => {
    const hand = card ? [card] : session.state.cards.filter((candidate) => candidate.controller === player && candidate.location === "hand" && isMonsterLike(candidate.kind));
    const actions = [...normalSummonActions(session.state, player, hand), ...tributeSummonActions(session.state, player, hand)];
    if (card && isNoTributePlayerAffected(session, player)) {
      return normalSummonActionMatchesType("normalSummon", summonType) && availableMonsterZoneCount(session, player, []) > 0 && !isNormalSummonPrevented(session.state, player, card, createPlayerCheckContext(session));
    }
    const available = actions.filter((action) => {
      const target = "uid" in action ? findCard(session.state, action.uid) : undefined;
      return Boolean(target && normalSummonActionMatchesType(action.type, summonType) && !isNormalSummonPrevented(session.state, player, target, createPlayerCheckContext(session)));
    });
    return card ? available.some((action) => actionHasUid(action, card.uid)) : available.length > 0;
  };
  const readWithTributeOverride = (): boolean => (card ? withLuaMinTributeOverride(card, minTributes, readAvailable) : readAvailable());
  if (!ignoreCount) return readWithTributeOverride();
  const previous = session.state.players[player].normalSummonAvailable;
  session.state.players[player].normalSummonAvailable = true;
  try {
    return readWithTributeOverride();
  } finally {
    session.state.players[player].normalSummonAvailable = previous;
  }
}

function normalSummonActionMatchesType(actionType: string, summonType: number | undefined): boolean {
  if (summonType === luaSummonTypeTribute) return actionType === "tributeSummon";
  if (summonType === luaSummonTypeNormal) return actionType === "normalSummon";
  return actionType === "normalSummon" || actionType === "tributeSummon";
}

function actionHasUid(action: { type: string }, uid: string): action is { type: string; uid: string } {
  return "uid" in action && action.uid === uid;
}

function canSpecialSummon(session: DuelSession, player: PlayerId, targetPlayer: PlayerId, positionMask: number, uid: string | undefined, summonType?: number): boolean {
  const position = positionFromMask(positionMask);
  if (!position) return false;
  if (availableMonsterZoneCount(session, targetPlayer, []) <= 0) return false;
  if (!uid) return canPlayerSpecialSummon(session.state, targetPlayer);
  const card = findCard(session.state, uid);
  if (!card || !isMonsterLike(card.kind)) return false;
  if (card.controller !== player && card.owner !== player) return false;
  if (card.location === "extraDeck") {
    return (
      canPlayerSpecialSummon(session.state, targetPlayer, card, summonType, undefined, position) &&
      canMoveDuelCardToLocation(session.state, uid, "monsterZone", duelReason.summon | duelReason.specialSummon)
    );
  }
  return canSpecialSummonDuelCard(session.state, uid, targetPlayer, summonType, undefined, false, position);
}

function canSpecialSummonCount(session: DuelSession, player: PlayerId, count: number): boolean {
  if (!canPlayerSpecialSummon(session.state, player)) return false;
  return maxSimultaneousSpecialSummonCount(session.state, player, availableMonsterZoneCount(session, player, [])) >= count;
}

function canPendulumSummon(session: DuelSession, player: PlayerId): boolean {
  if (!isMainPhaseForPlayer(session, player)) return false;
  if (!hasPendulumSummonAvailable(session.state, player)) return false;
  if (!canSpecialSummonCount(session, player, 1)) return false;
  if (availableMonsterZoneCount(session, player, []) <= 0) return false;
  const scales = pendulumScales(session, player);
  if (!scales) return false;
  return session.state.cards.some((card) => canPendulumSummonCard(session, player, card, scales));
}

function canPendulumSummonCard(session: DuelSession, player: PlayerId, card: DuelCardInstance, scales: PendulumScaleInfo): boolean {
  if (card.controller !== player || !isPendulumMonster(session, card)) return false;
  if (card.location !== "hand" && !(card.location === "extraDeck" && card.faceUp)) return false;
  const level = currentLevel(card, session.state);
  if ((level <= scales.lowScale || level >= scales.highScale) && !currentCardHasEffect(card, session.state, pendulumLevelBypassEffectCode) && !scales.anyLevelCandidateAllowed) return false;
  return canSpecialSummonDuelCard(session.state, card.uid, player, luaSummonTypePendulum);
}

function pendulumScales(session: DuelSession, player: PlayerId): PendulumScaleInfo | undefined {
  const left = pendulumZoneCard(session, player, 0);
  const right = pendulumZoneCard(session, player, 1);
  if (!left || !right) return undefined;
  const low = Math.min(pendulumScale(session, left), pendulumScale(session, right));
  const high = Math.max(pendulumScale(session, left), pendulumScale(session, right));
  return low < high ? { anyLevelCandidateAllowed: currentCardHasEffect(left, session.state, pendulumAnyLevelScaleEffectCode) && currentCardHasEffect(right, session.state, pendulumAnyLevelScaleEffectCode), highScale: high, lowScale: low } : undefined;
}

function pendulumZoneCard(session: DuelSession, player: PlayerId, sequence: number): DuelCardInstance | undefined {
  return session.state.cards.find((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence && isPendulumCard(session, card));
}

function pendulumScale(session: DuelSession, card: DuelCardInstance): number {
  return card.data.leftScale === undefined ? currentRightScale(card, session.state) : currentLeftScale(card, session.state);
}

function syntheticSpecialSummonCard(L: unknown, player: PlayerId): DuelCardInstance {
  const code = String(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0);
  const setcode = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : undefined;
  const data: DuelCardData = {
    code,
    name: `Synthetic ${code}`,
    kind: "monster",
    ...(lua.lua_isnumber(L, 4) ? { typeFlags: lua.lua_tointeger(L, 4) } : {}),
    ...(lua.lua_isnumber(L, 5) ? { attack: lua.lua_tointeger(L, 5) } : {}),
    ...(lua.lua_isnumber(L, 6) ? { defense: lua.lua_tointeger(L, 6) } : {}),
    ...(lua.lua_isnumber(L, 7) ? { level: lua.lua_tointeger(L, 7) } : {}),
    ...(lua.lua_isnumber(L, 8) ? { race: lua.lua_tointeger(L, 8) } : {}),
    ...(lua.lua_isnumber(L, 9) ? { attribute: lua.lua_tointeger(L, 9) } : {}),
    ...(setcode === undefined || setcode === 0 ? {} : { setcodes: [setcode] }),
  };
  return {
    uid: `synthetic-${code}`,
    code,
    name: data.name,
    kind: "monster",
    owner: player,
    controller: player,
    location: "hand",
    sequence: -1,
    position: "faceDown",
    overlayUids: [],
    faceUp: false,
    data,
  };
}

function createPlayerCheckContext(session: DuelSession): ContinuousEffectContextFactory {
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

function pushPlayerMoveMatcher(L: unknown, fieldName: string, session: DuelSession, location: DuelLocation): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : session.state.turnPlayer;
    const uids = readCardOrGroupUids(state, 2);
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    lua.lua_pushboolean(state, uids.length === 0 || uids.every((uid) => canMoveDuelCardToLocation(session.state, uid, location, reason, player)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

interface CounterQuery {
  player: PlayerId;
  selfLocations: DuelLocation[];
  opponentLocations: DuelLocation[];
  counterType: number;
  count: number;
  reason: number;
}

function readCounterQuery(L: unknown, session: DuelSession): CounterQuery {
  return {
    player: normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer),
    selfLocations: counterLocations(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0),
    opponentLocations: counterLocations(lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0),
    counterType: lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0,
    count: Math.max(0, lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1),
    reason: lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : duelReason.effect,
  };
}

function counterLocations(mask: number): DuelLocation[] {
  if (mask === 1) return ["monsterZone", "spellTrapZone"];
  return locationsFromMask(mask);
}

function isCounterLocationIncluded(card: DuelCardInstance, player: PlayerId, selfLocations: DuelLocation[], opponentLocations: DuelLocation[]): boolean {
  if (card.controller === player) return selfLocations.includes(card.location);
  return opponentLocations.includes(card.location);
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

function isPendulumMonster(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1000001) === 0x1000001;
}

function isPendulumCard(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1000000) !== 0;
}

function luaEffectId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
