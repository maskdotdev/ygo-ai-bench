import fengari from "fengari";
import { canMoveDuelCardToLocation, detachDuelOverlayMaterials, registerEffect } from "./duel-core.js";
import { getDuelFlagEffectCount, registerDuelFlagEffect, resetDuelFlagEffect } from "./duel-flags.js";
import { duelReason } from "./duel-reasons.js";
import { pushGroupTable } from "./lua-group-api.js";
import {
  copyGlobalFunctionToField,
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readTableNumberField,
  readTableStringField,
} from "./lua-api-utils.js";
import type { CardPosition, DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardApiEffectRecord {
  id: number;
}

export interface LuaCardApiState<EffectRecord extends LuaCardApiEffectRecord> {
  effects: Map<number, EffectRecord>;
  operatedUids?: string[];
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
  installStateHelpers(L, session, hostState);
  installFlagHelpers(L, session);
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
    lua.lua_pushinteger(state, card ? Number(card.code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOriginalCode"));
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
  pushNumberGetter(L, "GetOriginalType", session, (card) => cardTypeFlags(card));
  pushNumberMatcher(L, "IsType", session, (card, requested) => (cardTypeFlags(card) & requested) !== 0);
  pushNumberGetter(L, "GetAttack", session, (card) => card?.data.attack ?? 0);
  pushNumberGetter(L, "GetBaseAttack", session, (card) => card?.data.attack ?? 0);
  pushNumberMatcher(L, "IsAttack", session, (card, requested) => (card.data.attack ?? 0) === requested);
  pushNumberGetter(L, "GetDefense", session, (card) => card?.data.defense ?? 0);
  pushNumberGetter(L, "GetBaseDefense", session, (card) => card?.data.defense ?? 0);
  pushNumberMatcher(L, "IsDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberGetter(L, "GetLevel", session, (card) => card?.data.level ?? 0);
  pushNumberGetter(L, "GetOriginalLevel", session, (card) => card?.data.level ?? 0);
  pushNumberMatcher(L, "IsLevel", session, (card, requested) => (card.data.level ?? 0) === requested);
  pushNumberGetter(L, "GetRank", session, (card) => cardRank(card));
  pushNumberGetter(L, "GetOriginalRank", session, (card) => cardRank(card));
  pushNumberMatcher(L, "IsRank", session, (card, requested) => cardRank(card) === requested);
  pushNumberGetter(L, "GetLink", session, (card) => cardLink(card));
  pushNumberGetter(L, "GetOriginalLink", session, (card) => cardLink(card));
  pushNumberMatcher(L, "IsLink", session, (card, requested) => cardLink(card) === requested);
  pushNumberGetter(L, "GetLinkMarker", session, (card) => card?.data.linkMarkers ?? 0);
  pushNumberGetter(L, "GetRace", session, (card) => card?.data.race ?? 0);
  pushNumberGetter(L, "GetOriginalRace", session, (card) => card?.data.race ?? 0);
  pushNumberMatcher(L, "IsRace", session, (card, requested) => ((card.data.race ?? 0) & requested) !== 0);
  pushNumberGetter(L, "GetAttribute", session, (card) => card?.data.attribute ?? 0);
  pushNumberGetter(L, "GetOriginalAttribute", session, (card) => card?.data.attribute ?? 0);
  pushNumberMatcher(L, "IsAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) !== 0);
}

function installStateHelpers<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  pushNumberGetter(L, "GetOwner", session, (card) => card?.owner ?? 0);
  pushNumberMatcher(L, "IsOwner", session, (card, requested) => card.owner === normalizePlayer(requested));
  pushNumberGetter(L, "GetControler", session, (card) => card?.controller ?? 0);
  pushNumberGetter(L, "GetLocation", session, (card) => locationMaskFromLocation(card?.location));
  pushNumberGetter(L, "GetSequence", session, (card) => card?.sequence ?? 0);
  pushNumberGetter(L, "GetPosition", session, (card) => positionMaskFromPosition(card?.position));
  pushNumberGetter(L, "GetOverlayCount", session, (card) => card?.overlayUids.length ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card?.overlayUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOverlayGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
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
  pushBooleanGetter(L, "IsOnField", session, (card) => Boolean(card && (card.location === "monsterZone" || card.location === "spellTrapZone")));
  pushBooleanGetter(L, "IsMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1) !== 0));
  pushBooleanGetter(L, "IsSpell", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x2) !== 0));
  pushBooleanGetter(L, "IsTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x4) !== 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && locationsFromMask(locationMask).includes(card.location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLocation"));
  pushNumberGetter(L, "GetPreviousLocation", session, (card) => locationMaskFromLocation(card?.previousLocation));
  pushNumberGetter(L, "GetPreviousSequence", session, (card) => card?.previousSequence ?? 0);
  pushNumberGetter(L, "GetPreviousPosition", session, (card) => positionMaskFromPosition(card?.previousPosition));
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
  pushNumberGetter(L, "GetReason", session, (card) => card?.reason ?? 0);
  pushNumberMatcher(L, "IsReason", session, (card, requested) => ((card.reason ?? 0) & requested) !== 0);
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
  pushBooleanGetter(L, "IsCanBeEffectTarget", session, (card) => Boolean(card));
}

function installFlagHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const value = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    if (!uid) {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code, reset, property, value);
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
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

function pushRemoveOverlayCard<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const player = lua.lua_isnumber(L, 2) ? normalizePlayer(lua.lua_tointeger(L, 2)) : card?.controller ?? 0;
  const min = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const max = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min;
  const reason = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : duelReason.cost;
  const detached = card ? detachOverlayRange(session, card, min, max, player, reason) : [];
  setOperatedUids(hostState, detached.map((material) => material.uid));
  lua.lua_pushinteger(L, detached.length);
  return 1;
}

function detachOverlayRange(session: DuelSession, card: DuelCardInstance, min: number, max: number, player: PlayerId, reason: number): DuelCardInstance[] {
  const count = Math.min(Math.max(min, 0), Math.max(max, 0), card.overlayUids.length);
  if (count < min) return [];
  try {
    return detachDuelOverlayMaterials(session.state, card.uid, count, player, reason);
  } catch {
    return [];
  }
}

function setOperatedUids<EffectRecord extends LuaCardApiEffectRecord>(hostState: LuaCardApiState<EffectRecord>, uids: string[]): void {
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, ...uids);
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

function cardRank(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
}

function cardLink(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x4000000) !== 0 ? card.data.level ?? 0 : 0;
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

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
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
  "GetOriginalCode",
  "IsCode",
  "IsOriginalCode",
  "IsSetCard",
  "GetOwner",
  "IsOwner",
  "GetControler",
  "GetType",
  "GetOriginalType",
  "IsType",
  "GetAttack",
  "GetBaseAttack",
  "IsAttack",
  "GetDefense",
  "GetBaseDefense",
  "IsDefense",
  "GetLevel",
  "GetOriginalLevel",
  "IsLevel",
  "GetRank",
  "GetOriginalRank",
  "IsRank",
  "GetLink",
  "GetOriginalLink",
  "IsLink",
  "GetLinkMarker",
  "GetRace",
  "GetOriginalRace",
  "IsRace",
  "GetAttribute",
  "GetOriginalAttribute",
  "IsAttribute",
  "IsFaceup",
  "IsFacedown",
  "GetLocation",
  "GetSequence",
  "GetPosition",
  "GetOverlayCount",
  "GetOverlayGroup",
  "RemoveOverlayCard",
  "IsPosition",
  "IsAttackPos",
  "IsDefensePos",
  "IsOnField",
  "IsMonster",
  "IsSpell",
  "IsTrap",
  "IsLocation",
  "GetPreviousLocation",
  "GetPreviousSequence",
  "GetPreviousPosition",
  "IsPreviousLocation",
  "IsPreviousPosition",
  "GetPreviousControler",
  "IsPreviousControler",
  "GetReason",
  "IsReason",
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
  "IsCanBeEffectTarget",
  "RegisterFlagEffect",
  "GetFlagEffect",
  "ResetFlagEffect",
];
