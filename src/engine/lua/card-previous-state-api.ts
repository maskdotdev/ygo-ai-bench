import fengari from "fengari";
import { readCardUid } from "#lua/api-utils.js";
import { cardCodes, isSetcodeMatch, readRequestedCodes, readRequestedNumbers } from "#lua/card-code-utils.js";
import { cardLink, cardRank, cardTypeFlags } from "#lua/card-stat-api.js";
import type { CardPosition, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardPreviousStateApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && (locationMaskFromLocation(card.location) & locationMask) !== 0));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDestination"));
  pushNumberGetter(L, "GetDestination", session, (card) => leaveFieldDestinationMask(card));
  pushNumberGetter(L, "GetLeaveFieldDest", session, (card) => leaveFieldDestinationMask(card));
  pushNumberMatcher(L, "IsLeaveFieldDest", session, (card, requested) => (leaveFieldDestinationMask(card) & requested) !== 0);
  pushNumberGetter(L, "GetPreviousLocation", session, (card) => locationMaskFromLocation(card?.previousLocation));
  pushNumberGetter(L, "GetPreviousSequence", session, (card) => card?.previousSequence ?? 0);
  pushNumberMatcher(L, "IsPreviousSequence", session, (card, requested) => card.previousSequence === requested);
  pushNumberGetter(L, "GetPreviousPosition", session, (card) => positionMaskFromPosition(card?.previousPosition));
  pushNumberGetter(L, "GetPreviousCode", session, (card) => (card?.previousLocation ? Number(card.code) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && readRequestedCodes(state, 2).includes(card.code)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousCodeOnField"));
  pushNumberGetter(L, "GetPreviousTypeOnField", session, (card) => (card?.previousLocation ? cardTypeFlags(card) : 0));
  pushNumberGetter(L, "GetPreviousAttackOnField", session, (card) => (card?.previousLocation ? card.data.attack ?? 0 : 0));
  pushNumberGetter(L, "GetPreviousDefenseOnField", session, (card) => (card?.previousLocation ? card.data.defense ?? 0 : 0));
  pushNumberGetter(L, "GetPreviousLevelOnField", session, (card) => (card?.previousLocation ? card.data.level ?? 0 : 0));
  pushNumberGetter(L, "GetPreviousRankOnField", session, (card) => (card?.previousLocation ? cardRank(card) : 0));
  pushNumberGetter(L, "GetPreviousLinkOnField", session, (card) => (card?.previousLocation ? cardLink(card) : 0));
  pushNumberGetter(L, "GetPreviousRaceOnField", session, (card) => (card?.previousLocation ? card.data.race ?? 0 : 0));
  pushNumberGetter(L, "GetPreviousAttributeOnField", session, (card) => (card?.previousLocation ? card.data.attribute ?? 0 : 0));
  pushBooleanGetter(L, "WasFaceup", session, (card) => Boolean(card?.previousLocation && card.previousFaceUp));
  pushBooleanGetter(L, "WasFacedown", session, (card) => Boolean(card?.previousLocation && !card.previousFaceUp));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && locationsFromMask(locationMask).includes(card.previousLocation)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card?.previousPosition && requestedPosition && card.previousPosition === requestedPosition));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousPosition"));
  pushNumberGetter(L, "GetPreviousControler", session, (card) => card?.previousController ?? 0);
  pushNumberMatcher(L, "IsPreviousControler", session, (card, requested) => card.previousController === normalizePlayer(requested));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedCodes = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requestedCodes.some((code) => cardCodes(card).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousCode"));
  pushNumberMatcher(L, "IsPreviousTypeOnField", session, (card, requested) => Boolean(card.previousLocation && (cardTypeFlags(card) & requested) !== 0));
  pushNumberMatcher(L, "IsPreviousAttackOnField", session, (card, requested) => Boolean(card.previousLocation && (card.data.attack ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousDefenseOnField", session, (card, requested) => Boolean(card.previousLocation && hasDefense(card) && (card.data.defense ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousLevelOnField", session, (card, requested) => Boolean(card.previousLocation && hasLevel(card) && (card.data.level ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousRankOnField", session, (card, requested) => Boolean(card.previousLocation && hasRank(card) && cardRank(card) === requested));
  pushNumberMatcher(L, "IsPreviousLinkOnField", session, (card, requested) => Boolean(card.previousLocation && cardLink(card) === requested));
  pushNumberMatcher(L, "IsPreviousRaceOnField", session, (card, requested) => Boolean(card.previousLocation && ((card.data.race ?? 0) & requested) !== 0));
  pushNumberMatcher(L, "IsPreviousAttributeOnField", session, (card, requested) => Boolean(card.previousLocation && ((card.data.attribute ?? 0) & requested) !== 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requested.some((wanted) => card.data.setcodes?.some((setcode) => isSetcodeMatch(wanted, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousSetCard"));
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushNumberMatcher(L: unknown, fieldName: string, session: DuelSession, matcher: (card: DuelCardInstance, requested: number) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && matcher(card, requested)));
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

function hasDefense(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0 && (cardTypeFlags(card) & 0x4000000) === 0;
}

function hasLevel(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0 && cardRank(card) === 0 && cardLink(card) === 0;
}

function hasRank(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x800000) !== 0;
}

function locationsFromMask(mask: number): DuelCardInstance["location"][] {
  const locations: DuelCardInstance["location"][] = [];
  if ((mask & 0x01) !== 0) locations.push("deck");
  if ((mask & 0x02) !== 0) locations.push("hand");
  if ((mask & 0x04) !== 0) locations.push("monsterZone");
  if ((mask & 0x08) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x10) !== 0) locations.push("graveyard");
  if ((mask & 0x20) !== 0) locations.push("banished");
  if ((mask & 0x40) !== 0) locations.push("extraDeck");
  return locations;
}

function locationMaskFromLocation(location: DuelCardInstance["location"] | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  return 0;
}

function leaveFieldDestinationMask(card: DuelCardInstance | undefined): number {
  if (!card || (card.previousLocation !== "monsterZone" && card.previousLocation !== "spellTrapZone")) return 0;
  return locationMaskFromLocation(card.location);
}

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}

function positionFromMask(mask: number): CardPosition | undefined {
  if ((mask & 0x1) !== 0) return "faceUpAttack";
  if ((mask & 0x4) !== 0) return "faceUpDefense";
  if ((mask & 0x8) !== 0) return "faceDownDefense";
  return undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
