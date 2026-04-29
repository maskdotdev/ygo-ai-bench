import fengari from "fengari";
import { locationsFromMask, positionFromMask, readCardUid, readGroupUids } from "./lua-api-utils.js";
import type { CardPosition, DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export function installDuelLocationApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, availableLocationCount(session, player, locationMask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, availableMonsterZoneCount(session, player, readAnyCardOrGroupUids(state, 3, 5)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCountFromEx"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, availableMonsterZoneCount(session, player, readCardOrGroupUids(state, 2)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMZoneCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const sequence = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushboolean(state, isLocationSequenceOpen(session, player, locationMask, sequence));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFieldZoneMask(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectDisableField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFieldZoneMask(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectField"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const positionMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0x1;
    lua.lua_pushinteger(state, positionMaskFromPosition(positionFromMask(positionMask) ?? "faceUpAttack"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectPosition"));
}

export function availableMonsterZoneCount(session: DuelSession, player: PlayerId, excludedUids: string[]): number {
  const occupied = session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone" && !excludedUids.includes(card.uid)).length;
  return Math.max(0, 5 - occupied);
}

function availableLocationCount(session: DuelSession, player: PlayerId, locationMask: number): number {
  const locations = locationsFromMask(locationMask);
  if (locations.includes("monsterZone")) return availableMonsterZoneCount(session, player, []);
  if (locations.includes("spellTrapZone")) return Math.max(0, 5 - matchingCardUids(session, player, 0x08).length);
  return 99;
}

function isLocationSequenceOpen(session: DuelSession, player: PlayerId, locationMask: number, sequence: number): boolean {
  const location = (locationMask & 0x04) !== 0 ? "monsterZone" : (locationMask & 0x08) !== 0 ? "spellTrapZone" : undefined;
  if (!location) return true;
  if (sequence < 0 || sequence >= 5) return false;
  return !session.state.cards.some((card) => card.controller === player && card.location === location && card.sequence === sequence);
}

function pushSelectedFieldZoneMask(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const count = Math.max(1, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1);
  const selfLocations = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const opponentLocations = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0;
  const filter = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const zones = selectableFieldZones(session, player, selfLocations, opponentLocations, filter).slice(0, count);
  lua.lua_pushinteger(L, zones.reduce((mask, zone) => mask | zone, 0));
  return 1;
}

function selectableFieldZones(session: DuelSession, player: PlayerId, selfLocations: number, opponentLocations: number, filter: number): number[] {
  return [
    ...zonesForLocation(session, player, selfLocations, 0, filter),
    ...zonesForLocation(session, otherPlayer(player), opponentLocations, 16, filter),
  ];
}

function zonesForLocation(session: DuelSession, player: PlayerId, locationMask: number, baseShift: number, filter: number): number[] {
  const zones: number[] = [];
  if ((locationMask & 0x04) !== 0) zones.push(...openZoneBits(session, player, "monsterZone", baseShift, filter));
  if ((locationMask & 0x08) !== 0) zones.push(...openZoneBits(session, player, "spellTrapZone", baseShift + 8, filter));
  return zones;
}

function openZoneBits(session: DuelSession, player: PlayerId, location: "monsterZone" | "spellTrapZone", baseShift: number, filter: number): number[] {
  const occupied = new Set(session.state.cards.filter((card) => card.controller === player && card.location === location).map((card) => card.sequence));
  const zones: number[] = [];
  for (let sequence = 0; sequence < 5; sequence += 1) {
    const bit = 1 << (baseShift + sequence);
    if (!occupied.has(sequence) && (filter === 0 || (filter & bit) !== 0)) zones.push(bit);
  }
  return zones;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readAnyCardOrGroupUids(L: unknown, start: number, end: number): string[] {
  const uids: string[] = [];
  for (let index = start; index <= end; index += 1) uids.push(...readCardOrGroupUids(L, index));
  return [...new Set(uids)];
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function positionMaskFromPosition(position: CardPosition): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
