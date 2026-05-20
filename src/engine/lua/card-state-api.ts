import fengari from "fengari";
import { locationMatchesCardMask, readCardUid } from "#lua/api-utils.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { cardFieldId } from "#duel/card-field-id.js";
import { continuousSetPosition } from "#duel/continuous-position-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { CardPosition, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardStateApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetOwner", session, (card) => card?.owner ?? 0);
  pushPlayerMatcher(L, "IsOwner", session, (card, requested) => requested.includes(card.owner));
  pushNumberGetter(L, "GetControler", session, (card) => card?.controller ?? 0);
  pushNumberGetter(L, "GetSummonPlayer", session, (card) => card?.summonPlayer ?? card?.controller ?? 0);
  pushNumberGetter(L, "GetSummonLocation", session, (card) => (card?.summonType ? locationMaskFromLocation(card.previousLocation) : 0));
  pushNumberGetter(L, "GetLocation", session, (card) => locationMaskFromLocation(card?.location));
  pushNumberGetter(L, "GetSequence", session, (card) => card?.sequence ?? 0);
  pushNumberGetter(L, "GetFieldID", session, (card) => cardFieldId(card));
  pushNumberGetter(L, "GetRealFieldID", session, (card) => cardFieldId(card));
  pushNumberGetter(L, "GetCardID", session, (card) => cardFieldId(card));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("SetHint"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.sequence)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSequence"));
  pushNumberMatcher(L, "IsFieldID", session, (card, requested) => cardFieldId(card) === requested);
  pushNumberMatcher(L, "IsRealFieldID", session, (card, requested) => cardFieldId(card) === requested);
  pushNumberGetter(L, "GetPosition", session, (card) => positionMaskFromPosition(effectivePosition(session, card)));
  pushBooleanGetter(L, "IsFaceup", session, (card) => Boolean(card?.faceUp));
  pushBooleanGetter(L, "IsFacedown", session, (card) => Boolean(card && !card.faceUp));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedPosition = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && (positionMaskFromPosition(effectivePosition(session, card)) & requestedPosition) !== 0));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPosition"));
  pushBooleanGetter(L, "IsAttackPos", session, (card) => Boolean(card && effectivePosition(session, card) === "faceUpAttack"));
  pushBooleanGetter(L, "IsDefensePos", session, (card) => Boolean(card && isDefensePosition(effectivePosition(session, card))));
  pushBooleanGetter(L, "IsPublic", session, (card) => Boolean(card && (card.faceUp || card.location === "graveyard")));
  pushBooleanGetter(L, "IsOnField", session, (card) => Boolean(card && (card.location === "monsterZone" || card.location === "spellTrapZone")));
  pushZonePredicate(L, "IsInMainMZone", session, (card) => card.location === "monsterZone" && card.sequence >= 0 && card.sequence <= 4);
  pushZonePredicate(L, "IsInExtraMZone", session, (card) => card.location === "monsterZone" && card.sequence >= 5 && card.sequence <= 6);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && locationMatchesCardMask(card, locationMask)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLocation"));
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
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && matcher(card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushPlayerMatcher(L: unknown, fieldName: string, session: DuelSession, matcher: (card: DuelCardInstance, requested: PlayerId[]) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedPlayers(state, 2);
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

function pushZonePredicate(L: unknown, fieldName: string, session: DuelSession, predicate: (card: DuelCardInstance) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const player = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && predicate(card) && (player === undefined || card.controller === player)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function readRequestedPlayers(L: unknown, startIndex: number): PlayerId[] {
  return readRequestedNumbers(L, startIndex).map(normalizePlayer);
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

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}

function effectivePosition(session: DuelSession, card: DuelCardInstance | undefined): CardPosition | undefined {
  if (!card) return undefined;
  return continuousSetPosition(
    session.state,
    card,
    (effect, source, target) => createEffectContext(session.state, source, effect.controller, undefined, target, [], true),
  ) ?? card.position;
}

function isDefensePosition(position: CardPosition | undefined): boolean {
  return position === "faceUpDefense" || position === "faceDownDefense";
}
