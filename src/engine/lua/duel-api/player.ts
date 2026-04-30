import fengari from "fengari";
import { canMoveDuelCardToLocation, canPlayerSpecialSummon, canSpecialSummonDuelCard } from "#duel/core.js";
import { findCard, moveDuelCard } from "#duel/card-state.js";
import { matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { canRemoveDuelCounters, removeDuelCounters } from "#duel/counters.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { locationsFromMask, positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { DuelCardData, DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const blueEyesSpiritRestrictionCode = 69832741;

export interface LuaDuelPlayerApiHostState {
  pushEffectTable: (state: unknown, id: number) => void;
  operatedUids?: string[];
}

export function installDuelPlayerApi(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): void {
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
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummonCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummonCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanSpecialSummonMonster(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanSpecialSummonMonster"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsPlayerAffectedByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsPlayerAffectedByEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsPlayerAffectedByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetPlayerEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanRemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveCounter"));
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

function pushCanSpecialSummonCount(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const count = Math.max(0, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1);
  lua.lua_pushboolean(L, canSpecialSummonCount(session, player, count));
  return 1;
}

function pushCanSpecialSummonMonster(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const targetPlayer = normalizePlayer(lua.lua_isnumber(L, 11) ? lua.lua_tointeger(L, 11) : player);
  const positionMask = lua.lua_isnumber(L, 10) ? lua.lua_tointeger(L, 10) : 0x1;
  const card = syntheticSpecialSummonCard(L, targetPlayer);
  lua.lua_pushboolean(L, Boolean(positionFromMask(positionMask)) && availableMonsterZoneCount(session, targetPlayer, []) > 0 && canPlayerSpecialSummon(session.state, targetPlayer, card));
  return 1;
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

function pushRemoveCounter(L: unknown, session: DuelSession, hostState: LuaDuelPlayerApiHostState): number {
  const query = readCounterQuery(L, session);
  const removed = removeDuelCounters(session.state, query.player, query.selfLocations, query.opponentLocations, query.counterType, query.count);
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, ...removed);
  lua.lua_pushinteger(L, removed.length > 0 ? query.count : 0);
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
  if (!uid) return canPlayerSpecialSummon(session.state, targetPlayer);
  const card = findCard(session.state, uid);
  if (!card || !isMonsterLike(card.kind)) return false;
  if (card.controller !== player && card.owner !== player) return false;
  return canSpecialSummonDuelCard(session.state, uid, targetPlayer);
}

function canSpecialSummonCount(session: DuelSession, player: PlayerId, count: number): boolean {
  if (!canPlayerSpecialSummon(session.state, player)) return false;
  return count < 2 || matchingPlayerEffects(session.state, player, blueEyesSpiritRestrictionCode, createPlayerCheckContext(session)).length === 0;
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
    const uids = readCardOrGroupUids(state, 2);
    lua.lua_pushboolean(state, uids.length === 0 || uids.every((uid) => canMoveDuelCardToLocation(session.state, uid, location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCounterQuery(L: unknown, session: DuelSession): {
  player: PlayerId;
  selfLocations: DuelLocation[];
  opponentLocations: DuelLocation[];
  counterType: number;
  count: number;
} {
  return {
    player: normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer),
    selfLocations: counterLocations(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0),
    opponentLocations: counterLocations(lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0),
    counterType: lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0,
    count: Math.max(0, lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 1),
  };
}

function counterLocations(mask: number): DuelLocation[] {
  if (mask === 1) return ["monsterZone", "spellTrapZone"];
  return locationsFromMask(mask);
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

function luaEffectId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
