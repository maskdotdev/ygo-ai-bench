import fengari from "fengari";
import { locationMatchesCardMask, readCardUid } from "#lua/api-utils.js";
import { cardCodes, isSetcodeMatch, readRequestedCodes, readRequestedNumbers } from "#lua/card-code-utils.js";
import { cardLink, cardRank, cardTypeFlags } from "#lua/card-stat-api.js";
import type { CardPosition, DuelCardInstance, DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardPreviousStateApiState {
  activeContext?: DuelEffectContext | undefined;
}

export function installCardPreviousStateApi(L: unknown, session: DuelSession, hostState?: LuaCardPreviousStateApiState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => isDestinationMatch(card, value, hostState))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDestination"));
  pushNumberGetter(L, "GetDestination", session, (card) => pendingDestinationMask(card, hostState) ?? leaveFieldDestinationMask(card));
  pushNumberGetter(L, "GetLeaveFieldDest", session, (card) => leaveFieldDestinationMask(card));
  pushAnyNumberMatcher(L, "IsLeaveFieldDest", session, (card, requested) => isLeaveFieldDestination(card) && requested.some((value) => locationMatchesCardMask(card, value)));
  pushNumberGetter(L, "GetPreviousLocation", session, (card) => locationMaskFromLocation(card?.previousLocation));
  pushNumberGetter(L, "GetPreviousSequence", session, (card) => card?.previousSequence ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requested.includes(card.previousSequence ?? -1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousSequence"));
  pushNumberGetter(L, "GetPreviousPosition", session, (card) => positionMaskFromPosition(card?.previousPosition));
  pushNumberGetter(L, "GetPreviousCode", session, (card) => (card?.previousLocation ? Number(previousCodes(card)[0] ?? 0) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedCodes = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requestedCodes.some((code) => previousCodes(card).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousCodeOnField"));
  pushNumberGetter(L, "GetPreviousTypeOnField", session, (card) => (card?.previousLocation ? previousTypeFlags(card) : 0));
  pushNumberGetter(L, "GetPreviousAttackOnField", session, (card) => (card?.previousLocation ? previousAttack(card) : 0));
  pushNumberGetter(L, "GetPreviousDefenseOnField", session, (card) => (card?.previousLocation ? previousDefense(card) : 0));
  pushNumberGetter(L, "GetPreviousLevelOnField", session, (card) => (card?.previousLocation ? previousLevel(card) : 0));
  pushNumberGetter(L, "GetPreviousRankOnField", session, (card) => (card?.previousLocation ? previousRank(card) : 0));
  pushNumberGetter(L, "GetPreviousLinkOnField", session, (card) => (card?.previousLocation ? previousLink(card) : 0));
  pushNumberGetter(L, "GetPreviousRaceOnField", session, (card) => (card?.previousLocation ? previousRace(card) : 0));
  pushNumberGetter(L, "GetPreviousAttributeOnField", session, (card) => (card?.previousLocation ? previousAttribute(card) : 0));
  pushBooleanGetter(L, "WasFaceup", session, (card) => Boolean(card?.previousLocation && card.previousFaceUp));
  pushBooleanGetter(L, "WasFacedown", session, (card) => Boolean(card?.previousLocation && !card.previousFaceUp));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requested.some((value) => locationMatchesCardMask(card, value, card.previousLocation, card.previousSequence))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const previousPosition = positionMaskFromPosition(card?.previousPosition);
    lua.lua_pushboolean(state, Boolean(card?.previousPosition && requested.some((value) => (previousPosition & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousPosition"));
  pushNumberGetter(L, "GetPreviousControler", session, (card) => card?.previousController ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2).map(normalizePlayer);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && card.previousController !== undefined && requested.includes(card.previousController)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousControler"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedCodes = readRequestedCodes(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requestedCodes.some((code) => previousCodes(card).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPreviousCode"));
  pushAnyNumberMatcher(L, "IsPreviousTypeOnField", session, (card, requested) => Boolean(card.previousLocation && requested.some((value) => (previousTypeFlags(card) & value) !== 0)));
  pushNumberMatcher(L, "IsPreviousAttackOnField", session, (card, requested) => Boolean(card.previousLocation && previousAttack(card) === requested));
  pushNumberMatcher(L, "IsPreviousDefenseOnField", session, (card, requested) => Boolean(card.previousLocation && hasPreviousDefense(card) && previousDefense(card) === requested));
  pushNumberMatcher(L, "IsPreviousLevelOnField", session, (card, requested) => Boolean(card.previousLocation && hasPreviousLevel(card) && previousLevel(card) === requested));
  pushNumberMatcher(L, "IsPreviousRankOnField", session, (card, requested) => Boolean(card.previousLocation && hasPreviousRank(card) && previousRank(card) === requested));
  pushNumberMatcher(L, "IsPreviousLinkOnField", session, (card, requested) => Boolean(card.previousLocation && previousLink(card) === requested));
  pushAnyNumberMatcher(L, "IsPreviousRaceOnField", session, (card, requested) => Boolean(card.previousLocation && requested.some((value) => (previousRace(card) & value) !== 0)));
  pushAnyNumberMatcher(L, "IsPreviousAttributeOnField", session, (card, requested) => Boolean(card.previousLocation && requested.some((value) => (previousAttribute(card) & value) !== 0)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.previousLocation && requested.some((wanted) => previousSetcodes(card).some((setcode) => isSetcodeMatch(wanted, setcode)))));
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

function pushAnyNumberMatcher(L: unknown, fieldName: string, session: DuelSession, matcher: (card: DuelCardInstance, requested: number[]) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.length > 0 && matcher(card, requested)));
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

function previousCodes(card: DuelCardInstance): string[] {
  return card.previousCodes ?? cardCodes(card);
}

function previousSetcodes(card: DuelCardInstance): number[] {
  return card.previousSetcodes ?? card.data.setcodes ?? [];
}

function previousTypeFlags(card: DuelCardInstance): number {
  return card.previousTypeFlags ?? cardTypeFlags(card);
}

function previousAttack(card: DuelCardInstance): number {
  return card.previousAttack ?? card.data.attack ?? 0;
}

function previousDefense(card: DuelCardInstance): number {
  return card.previousDefense ?? card.data.defense ?? 0;
}

function previousLevel(card: DuelCardInstance): number {
  return card.previousLevel ?? card.data.level ?? 0;
}

function previousRank(card: DuelCardInstance): number {
  return card.previousRank ?? cardRank(card);
}

function previousLink(card: DuelCardInstance): number {
  return card.previousLink ?? cardLink(card);
}

function previousRace(card: DuelCardInstance): number {
  return card.previousRace ?? card.data.race ?? 0;
}

function previousAttribute(card: DuelCardInstance): number {
  return card.previousAttribute ?? card.data.attribute ?? 0;
}

function hasPreviousDefense(card: DuelCardInstance): boolean {
  return (previousTypeFlags(card) & 0x1) !== 0 && (previousTypeFlags(card) & 0x4000000) === 0;
}

function hasPreviousLevel(card: DuelCardInstance): boolean {
  return (previousTypeFlags(card) & 0x1) !== 0 && (previousTypeFlags(card) & 0x800000) === 0 && (previousTypeFlags(card) & 0x4000000) === 0;
}

function hasPreviousRank(card: DuelCardInstance): boolean {
  return (previousTypeFlags(card) & 0x800000) !== 0;
}

function locationMaskFromLocation(location: DuelCardInstance["location"] | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}

function leaveFieldDestinationMask(card: DuelCardInstance | undefined): number {
  if (!isLeaveFieldDestination(card)) return 0;
  return locationMaskFromLocation(card.location);
}

function pendingDestinationMask(card: DuelCardInstance | undefined, hostState: LuaCardPreviousStateApiState | undefined): number | undefined {
  if (!card || hostState?.activeContext?.eventCard?.uid !== card.uid || hostState.activeContext.eventDestination === undefined) return undefined;
  return locationMaskFromLocation(hostState.activeContext.eventDestination);
}

function isDestinationMatch(card: DuelCardInstance, requested: number, hostState: LuaCardPreviousStateApiState | undefined): boolean {
  const pending = pendingDestinationMask(card, hostState);
  if (pending !== undefined) return (pending & requested) !== 0;
  return locationMatchesCardMask(card, requested);
}

function isLeaveFieldDestination(card: DuelCardInstance | undefined): card is DuelCardInstance {
  return Boolean(card && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone"));
}

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
