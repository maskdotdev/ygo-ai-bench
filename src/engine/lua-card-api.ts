import fengari from "fengari";
import { canMoveDuelCardToLocation, registerEffect } from "./duel-core.js";
import {
  copyGlobalFunctionToField,
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readTableNumberField,
  readTableStringField,
} from "./lua-api-utils.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardApiEffectRecord {
  id: number;
}

export interface LuaCardApiState<EffectRecord extends LuaCardApiEffectRecord> {
  effects: Map<number, EffectRecord>;
}

export function installCardApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  toDuelEffect: (card: DuelCardInstance, luaEffect: EffectRecord, state: unknown) => DuelEffectDefinition,
): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const cardUid = readTableStringField(state, 1, "__duel_uid");
    const effectId = readTableNumberField(state, 2, "__effect_id");
    const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
    const luaEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
    if (!card || !luaEffect) return 0;
    registerEffect(session, toDuelEffect(card, luaEffect, state));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  installCodeHelpers(L, session);
  installStatHelpers(L, session);
  installStateHelpers(L, session);
  lua.lua_setglobal(L, to_luastring("Card"));
}

export function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  for (const fieldName of cardFieldNames) copyGlobalFunctionToField(L, "Card", fieldName);
}

function installCodeHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushinteger(state, card ? Number(card.code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
}

function installStatHelpers(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetType", session, (card) => cardTypeFlags(card));
  pushNumberMatcher(L, "IsType", session, (card, requested) => (cardTypeFlags(card) & requested) !== 0);
  pushNumberGetter(L, "GetAttack", session, (card) => card?.data.attack ?? 0);
  pushNumberMatcher(L, "IsAttack", session, (card, requested) => (card.data.attack ?? 0) === requested);
  pushNumberGetter(L, "GetDefense", session, (card) => card?.data.defense ?? 0);
  pushNumberMatcher(L, "IsDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberGetter(L, "GetLevel", session, (card) => card?.data.level ?? 0);
  pushNumberMatcher(L, "IsLevel", session, (card, requested) => (card.data.level ?? 0) === requested);
  pushNumberGetter(L, "GetRace", session, (card) => card?.data.race ?? 0);
  pushNumberMatcher(L, "IsRace", session, (card, requested) => ((card.data.race ?? 0) & requested) !== 0);
  pushNumberGetter(L, "GetAttribute", session, (card) => card?.data.attribute ?? 0);
  pushNumberMatcher(L, "IsAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) !== 0);
}

function installStateHelpers(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsFaceup", session, (card) => Boolean(card?.faceUp));
  pushBooleanGetter(L, "IsFacedown", session, (card) => Boolean(card && !card.faceUp));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requestedPosition && card.position === requestedPosition));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPosition"));
  pushBooleanGetter(L, "IsAttackPos", session, (card) => Boolean(card && card.position === "faceUpAttack"));
  pushBooleanGetter(L, "IsDefensePos", session, (card) => Boolean(card && (card.position === "faceUpDefense" || card.position === "faceDownDefense")));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && locationsFromMask(locationMask).includes(card.location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const player = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && player !== undefined && card.controller === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsControler"));
  pushNumberGetter(L, "GetSummonType", session, (card) => summonTypeMask(card));
  pushNumberMatcher(L, "IsSummonType", session, (card, requested) => isSummonTypeMatch(summonTypeMask(card), requested));
  pushBooleanGetter(L, "IsAbleToGrave", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard")));
  pushBooleanGetter(L, "IsAbleToHand", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand")));
  pushBooleanGetter(L, "IsAbleToDeck", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck")));
  pushBooleanGetter(L, "IsAbleToRemove", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished")));
  pushBooleanGetter(L, "IsAbleToExtra", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "extraDeck")));
  pushBooleanGetter(L, "IsRelateToEffect", session, (card) => Boolean(card));
  pushBooleanGetter(L, "IsRelateToBattle", session, (_, uid) => Boolean(uid && (session.state.currentAttack?.attackerUid === uid || session.state.currentAttack?.targetUid === uid)));
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

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined, uid: string | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, getter(card, uid));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession | undefined): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid && session ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function cardTypeFlags(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function summonTypeMask(card: DuelCardInstance | undefined): number {
  if (!card?.summonType) return 0;
  if (card.summonType === "normal") return 0x10000000;
  if (card.summonType === "tribute") return 0x11000000;
  if (card.summonType === "flip") return 0x20000000;
  if (card.summonType === "special") return 0x40000000;
  if (card.summonType === "fusion") return 0x43000000;
  if (card.summonType === "ritual") return 0x45000000;
  if (card.summonType === "synchro") return 0x46000000;
  if (card.summonType === "xyz") return 0x49000000;
  if (card.summonType === "link") return 0x4c000000;
  return 0;
}

function isSummonTypeMatch(actual: number, requested: number): boolean {
  if (actual === 0 || requested === 0) return false;
  return actual === requested || (actual & requested) === requested;
}

const cardFieldNames = [
  "RegisterEffect",
  "GetCode",
  "IsCode",
  "IsOriginalCode",
  "IsSetCard",
  "GetType",
  "IsType",
  "GetAttack",
  "IsAttack",
  "GetDefense",
  "IsDefense",
  "GetLevel",
  "IsLevel",
  "GetRace",
  "IsRace",
  "GetAttribute",
  "IsAttribute",
  "IsFaceup",
  "IsFacedown",
  "IsPosition",
  "IsAttackPos",
  "IsDefensePos",
  "IsLocation",
  "IsControler",
  "GetSummonType",
  "IsSummonType",
  "IsAbleToGrave",
  "IsAbleToHand",
  "IsAbleToDeck",
  "IsAbleToRemove",
  "IsAbleToExtra",
  "IsRelateToEffect",
  "IsRelateToBattle",
];
