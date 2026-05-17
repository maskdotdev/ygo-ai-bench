import fengari from "fengari";
import { cardTypeFlags, currentLinkMarkers } from "#duel/card-stats.js";
import { availableFieldZoneCount, isFieldZoneDisabled } from "#duel/disabled-field-zones.js";
import { availableForcedMonsterZoneCount, forcedMonsterZoneAllowedMask } from "#duel/forced-monster-zones.js";
import { locationsFromMask, positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { CardPosition, DuelCardInstance, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaPromptDecision } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelLocationApiHostState {
  promptDecisions?: LuaPromptDecision[];
  nextPromptId?: number;
  promptBehavior?: "default" | "yield";
}

export function installDuelLocationApi(L: unknown, session: DuelSession, hostState: LuaDuelLocationApiHostState = {}): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reason = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const zoneMask = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    lua.lua_pushinteger(state, availableLocationCount(session, player, locationMask, zoneMask, reason));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const reason = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const zoneMask = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    lua.lua_pushinteger(state, availableMonsterZoneCountInMask(session, player, readAnyCardOrGroupUids(state, 3, 4), zoneMask, reason));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCountFromEx"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const reason = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const zoneMask = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    lua.lua_pushinteger(state, availableMonsterZoneCountInMask(session, player, readCardOrGroupUids(state, 2), zoneMask, reason));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMZoneCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const reason = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const zoneMask = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    lua.lua_pushinteger(state, availableMonsterZoneCountInMask(session, player, readCardOrGroupUids(state, 2), zoneMask, reason));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetUsableMZoneCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const sequence = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushboolean(state, isLocationSequenceOpen(session, player, locationMask, sequence));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckPendulumZones(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckPendulumZones"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFieldZoneMask(state, session, hostState, "SelectDisableField"));
  lua.lua_setfield(L, -2, to_luastring("SelectDisableField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFieldZoneMask(state, session, hostState, "SelectField"));
  lua.lua_setfield(L, -2, to_luastring("SelectField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedFieldZoneMask(state, session, hostState, "SelectFieldZone"));
  lua.lua_setfield(L, -2, to_luastring("SelectFieldZone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const count = Math.max(1, lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    lua.lua_pushinteger(state, linkedZoneMaskWithCount(session, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetZoneWithLinkedCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, linkedZoneMaskForPlayer(session, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedZone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const selfLocations = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0x04;
    const opponentLocations = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    pushGroupTable(state, linkedGroupUidsForPlayer(session, player, selfLocations, opponentLocations));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const positionMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0x1;
    lua.lua_pushinteger(state, positionMaskFromPosition(positionFromMask(positionMask) ?? "faceUpAttack"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectPosition"));
}

export function availableMonsterZoneCount(session: DuelSession, player: PlayerId, excludedUids: string[]): number {
  return availableForcedMonsterZoneCount(session.state, player, excludedUids);
}

function availableLocationCount(session: DuelSession, player: PlayerId, locationMask: number, zoneMask: number, reason: number): number {
  const locations = locationsFromMask(locationMask);
  if (locations.includes("monsterZone")) return availableMonsterZoneCountInMask(session, player, [], zoneMask, reason);
  if ((locationMask & 0x200) !== 0) return availablePendulumZoneCount(session, player);
  if (locations.includes("spellTrapZone")) return availableSpellTrapZoneCountInMask(session, player, zoneMask);
  return 99;
}

function availableMonsterZoneCountInMask(session: DuelSession, player: PlayerId, excludedUids: string[], zoneMask: number, reason: number): number {
  return availableForcedMonsterZoneCount(session.state, player, excludedUids, zoneMask, reason);
}

function availableSpellTrapZoneCountInMask(session: DuelSession, player: PlayerId, zoneMask: number): number {
  return availableFieldZoneCount(session.state, player, "spellTrapZone", [], zoneMask);
}

function isLocationSequenceOpen(session: DuelSession, player: PlayerId, locationMask: number, sequence: number): boolean {
  if ((locationMask & 0x200) !== 0) return isPendulumZoneOpen(session, player, sequence);
  const location = (locationMask & 0x04) !== 0 ? "monsterZone" : (locationMask & 0x08) !== 0 ? "spellTrapZone" : undefined;
  if (!location) return true;
  if (sequence < 0 || sequence >= 5) return false;
  if (isFieldZoneDisabled(session.state, player, location, sequence)) return false;
  if (location === "monsterZone" && (forcedMonsterZoneAllowedMask(session.state, player) & (1 << sequence)) === 0) return false;
  return !session.state.cards.some((card) => card.controller === player && card.location === location && card.sequence === sequence);
}

function pushCheckPendulumZones(L: unknown, session: DuelSession): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  lua.lua_pushboolean(L, availablePendulumZoneCount(session, player) > 0);
  return 1;
}

function availablePendulumZoneCount(session: DuelSession, player: PlayerId): number {
  return [0, 1].filter((sequence) => isPendulumZoneOpen(session, player, sequence)).length;
}

function isPendulumZoneOpen(session: DuelSession, player: PlayerId, sequence: number): boolean {
  if (sequence < 0 || sequence > 1) return false;
  if (isFieldZoneDisabled(session.state, player, "spellTrapZone", sequence)) return false;
  return !session.state.cards.some((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence);
}

function pushSelectedFieldZoneMask(L: unknown, session: DuelSession, hostState: LuaDuelLocationApiHostState, api: "SelectDisableField" | "SelectField" | "SelectFieldZone"): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const count = Math.max(1, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1);
  const selfLocations = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const opponentLocations = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0;
  const filter = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const options = selectableFieldZoneMasks(session, player, count, selfLocations, opponentLocations, filter);
  const returned = options[0] ?? 0;
  if (options.length > 0) {
    const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api, player, options, descriptions: [...options], returned };
    hostState.promptDecisions?.push(decision);
    if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  }
  lua.lua_pushinteger(L, returned);
  return 1;
}

function nextLuaPromptId(hostState: LuaDuelLocationApiHostState): string {
  const id = hostState.nextPromptId ?? 1;
  hostState.nextPromptId = id + 1;
  return `lua-prompt-${id}`;
}

function selectableFieldZoneMasks(session: DuelSession, player: PlayerId, count: number, selfLocations: number, opponentLocations: number, filter: number): number[] {
  const zones = selectableFieldZones(session, player, selfLocations, opponentLocations, filter);
  if (count <= 1) return zones;
  const masks: number[] = [];
  collectZoneMaskCombinations(zones, count, 0, 0, masks);
  return masks;
}

function collectZoneMaskCombinations(zones: number[], remaining: number, start: number, mask: number, masks: number[]): void {
  if (remaining === 0) {
    masks.push(mask);
    return;
  }
  for (let index = start; index <= zones.length - remaining; index += 1) {
    collectZoneMaskCombinations(zones, remaining - 1, index + 1, mask | zones[index]!, masks);
  }
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
    if (!occupied.has(sequence) && !isFieldZoneDisabled(session.state, player, location, sequence) && (filter & bit) === 0) zones.push(bit);
  }
  return zones;
}

function linkedZoneMaskWithCount(session: DuelSession, player: PlayerId, count: number): number {
  let mask = 0;
  for (const zone of [0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40]) {
    const linkedCount = session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone" && card.faceUp && linkedZoneMask(card, session.state, player) & zone).length;
    if (linkedCount >= count) mask |= zone;
  }
  return mask;
}

export function linkedZoneMaskForPlayer(session: DuelSession, player: PlayerId): number {
  return session.state.cards.filter((card) => card.controller === player).reduce((mask, card) => mask | linkedZoneMask(card, session.state, player), 0);
}

export function linkedZoneMaskForUids(session: DuelSession, uids: readonly string[], targetPlayer?: PlayerId): number {
  const uidSet = new Set(uids);
  return session.state.cards.filter((card) => uidSet.has(card.uid)).reduce((mask, card) => mask | linkedZoneMask(card, session.state, targetPlayer), 0);
}

export function linkedGroupUidsForCard(session: DuelSession, card: DuelCardInstance): string[] {
  const mask = linkedZoneMask(card, session.state);
  if (mask === 0) return [];
  return session.state.cards
    .filter((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && candidate.faceUp && ((1 << candidate.sequence) & mask) !== 0)
    .map((candidate) => candidate.uid);
}

export function linkedZoneMask(card: DuelCardInstance, state?: DuelState, targetPlayer?: PlayerId): number {
  if (card.location !== "monsterZone" || !card.faceUp || (cardTypeFlags(card, state) & 0x4000001) !== 0x4000001) return 0;
  return linkedSequences(card.sequence, currentLinkMarkers(card, state)).reduce((mask, sequence) => {
    const ownZone = 1 << sequence;
    if (targetPlayer !== undefined) return mask | ownZone;
    const opponentZone = sequence < 5 ? 1 << (16 + sequence) : 0;
    return mask | ownZone | opponentZone;
  }, 0);
}

function linkedGroupUidsForPlayer(session: DuelSession, player: PlayerId, selfLocations: number, opponentLocations: number): string[] {
  return [
    ...linkedGroupUidsForField(session, player, selfLocations),
    ...linkedGroupUidsForField(session, otherPlayer(player), opponentLocations),
  ];
}

function linkedGroupUidsForField(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const linkedZones = linkedZoneMaskForPlayer(session, player);
  const locations = locationsFromMask(locationMask);
  if (linkedZones === 0 || locations.length === 0) return [];
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location) && ((1 << card.sequence) & linkedZones) !== 0)
    .map((card) => card.uid);
}

function linkedSequences(sequence: number, markers: number): number[] {
  const sequences: number[] = [];
  if (sequence === 5) {
    if ((markers & 0x1) !== 0) sequences.push(0);
    if ((markers & 0x2) !== 0) sequences.push(1);
    if ((markers & 0x4) !== 0) sequences.push(2);
  } else if (sequence === 6) {
    if ((markers & 0x1) !== 0) sequences.push(2);
    if ((markers & 0x2) !== 0) sequences.push(3);
    if ((markers & 0x4) !== 0) sequences.push(4);
  } else if ((markers & 0x1) !== 0 || (markers & 0x2) !== 0 || (markers & 0x4) !== 0) {
    sequences.push(sequence);
  }
  if ((markers & 0x8) !== 0) sequences.push(sequence - 1);
  if ((markers & 0x20) !== 0) sequences.push(sequence + 1);
  return [...new Set(sequences)].filter((target) => target >= 0 && target <= 6);
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
