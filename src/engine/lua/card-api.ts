import fengari from "fengari";
import { hasZoneSpace } from "#duel/card-state.js";
import { canChangeDuelCardPosition, canMoveDuelCardToLocation, canSpecialSummonDuelCard, detachDuelOverlayMaterials, moveDuelCard, registerEffect } from "#duel/core.js";
import { findIndestructibleEffect, isCardDisabled, isMaterialUsePrevented, type ContinuousEffectContextFactory, type MaterialUseKind } from "#duel/continuous-effects.js";
import { addDuelCardCounter, canAddDuelCardCounter, getDuelCardCounter, removeDuelCardCounter } from "#duel/counters.js";
import { getDuelFlagEffectCount, getDuelFlagEffectLabel, registerDuelFlagEffect, resetDuelFlagEffect, setDuelFlagEffectLabel } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import { normalSummonActions } from "#duel/summon.js";
import { pushGroupTable } from "#lua/group-api.js";
import { canLuaSynchroSummonCard } from "#lua/synchro-summonable.js";
import {
  copyGlobalFunctionToField,
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readGroupUids,
  readTableNumberField,
  readTableStringField,
} from "#lua/api-utils.js";
import type { CardPosition, DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaCardApiEffectRecord {
  id: number;
  typeFlags?: number;
  sourceUid?: string;
  code?: number;
}

export interface LuaCardApiState<EffectRecord extends LuaCardApiEffectRecord> {
  effects: Map<number, EffectRecord>;
  operatedUids?: string[];
  pushEffectTable: (state: unknown, id: number) => void;
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
    lua.lua_pushinteger(state, card ? Number(card.code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOriginalCodeRule"));
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
    lua.lua_pushboolean(state, Boolean(card && requested && !cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCodeRule"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && !card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotSetCard"));
}

function installStatHelpers(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetType", session, (card) => cardTypeFlags(card));
  pushNumberGetter(L, "GetOriginalType", session, (card) => cardTypeFlags(card));
  pushNumberMatcher(L, "IsType", session, (card, requested) => (cardTypeFlags(card) & requested) !== 0);
  pushNumberMatcher(L, "IsNotType", session, (card, requested) => (cardTypeFlags(card) & requested) === 0);
  pushNumberMatcher(L, "IsOriginalType", session, (card, requested) => (cardTypeFlags(card) & requested) !== 0);
  pushNumberMatcher(L, "IsNotOriginalType", session, (card, requested) => (cardTypeFlags(card) & requested) === 0);
  pushNumberGetter(L, "GetAttack", session, (card) => card?.data.attack ?? 0);
  pushNumberGetter(L, "GetBaseAttack", session, (card) => card?.data.attack ?? 0);
  pushBooleanGetter(L, "HasNonZeroAttack", session, (card) => Boolean(card && (card.data.attack ?? 0) !== 0));
  pushNumberMatcher(L, "IsAttack", session, (card, requested) => (card.data.attack ?? 0) === requested);
  pushNumberMatcher(L, "IsOriginalAttack", session, (card, requested) => (card.data.attack ?? 0) === requested);
  pushNumberMatcher(L, "IsAttackAbove", session, (card, requested) => (card.data.attack ?? 0) >= requested);
  pushNumberMatcher(L, "IsAttackBelow", session, (card, requested) => (card.data.attack ?? 0) <= requested);
  pushNumberMatcher(L, "IsOriginalAttackAbove", session, (card, requested) => (card.data.attack ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalAttackBelow", session, (card, requested) => (card.data.attack ?? 0) <= requested);
  pushNumberGetter(L, "GetDefense", session, (card) => card?.data.defense ?? 0);
  pushNumberGetter(L, "GetBaseDefense", session, (card) => card?.data.defense ?? 0);
  pushNumberMatcher(L, "IsDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberMatcher(L, "IsOriginalDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberMatcher(L, "IsDefenseAbove", session, (card, requested) => (card.data.defense ?? 0) >= requested);
  pushNumberMatcher(L, "IsDefenseBelow", session, (card, requested) => (card.data.defense ?? 0) <= requested);
  pushNumberMatcher(L, "IsOriginalDefenseAbove", session, (card, requested) => (card.data.defense ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalDefenseBelow", session, (card, requested) => (card.data.defense ?? 0) <= requested);
  pushNumberGetter(L, "GetLevel", session, (card) => card?.data.level ?? 0);
  pushNumberGetter(L, "GetOriginalLevel", session, (card) => card?.data.level ?? 0);
  pushBooleanGetter(L, "HasLevel", session, (card) => Boolean(card && (card.data.level ?? 0) > 0 && cardRank(card) === 0 && cardLink(card) === 0));
  pushNumberMatcher(L, "IsLevel", session, (card, requested) => (card.data.level ?? 0) === requested);
  pushNumberMatcher(L, "IsLevelAbove", session, (card, requested) => (card.data.level ?? 0) >= requested);
  pushNumberMatcher(L, "IsLevelBelow", session, (card, requested) => (card.data.level ?? 0) <= requested);
  pushNumberMatcher(L, "IsOriginalLevel", session, (card, requested) => (card.data.level ?? 0) === requested);
  pushNumberMatcher(L, "IsOriginalLevelAbove", session, (card, requested) => (card.data.level ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalLevelBelow", session, (card, requested) => (card.data.level ?? 0) <= requested);
  pushNumberGetter(L, "GetRank", session, (card) => cardRank(card));
  pushNumberGetter(L, "GetOriginalRank", session, (card) => cardRank(card));
  pushNumberMatcher(L, "IsRank", session, (card, requested) => cardRank(card) === requested);
  pushNumberMatcher(L, "IsRankAbove", session, (card, requested) => cardRank(card) >= requested);
  pushNumberMatcher(L, "IsRankBelow", session, (card, requested) => cardRank(card) <= requested);
  pushNumberMatcher(L, "IsOriginalRank", session, (card, requested) => cardRank(card) === requested);
  pushNumberMatcher(L, "IsOriginalRankAbove", session, (card, requested) => cardRank(card) >= requested);
  pushNumberMatcher(L, "IsOriginalRankBelow", session, (card, requested) => cardRank(card) <= requested);
  pushNumberGetter(L, "GetLink", session, (card) => cardLink(card));
  pushNumberGetter(L, "GetOriginalLink", session, (card) => cardLink(card));
  pushNumberMatcher(L, "IsLink", session, (card, requested) => cardLink(card) === requested);
  pushNumberMatcher(L, "IsLinkAbove", session, (card, requested) => cardLink(card) >= requested);
  pushNumberMatcher(L, "IsLinkBelow", session, (card, requested) => cardLink(card) <= requested);
  pushNumberMatcher(L, "IsOriginalLink", session, (card, requested) => cardLink(card) === requested);
  pushNumberMatcher(L, "IsOriginalLinkAbove", session, (card, requested) => cardLink(card) >= requested);
  pushNumberMatcher(L, "IsOriginalLinkBelow", session, (card, requested) => cardLink(card) <= requested);
  pushNumberGetter(L, "GetLinkMarker", session, (card) => card?.data.linkMarkers ?? 0);
  pushNumberGetter(L, "GetRace", session, (card) => card?.data.race ?? 0);
  pushNumberGetter(L, "GetOriginalRace", session, (card) => card?.data.race ?? 0);
  pushNumberMatcher(L, "IsRace", session, (card, requested) => ((card.data.race ?? 0) & requested) !== 0);
  pushNumberMatcher(L, "IsNotRace", session, (card, requested) => ((card.data.race ?? 0) & requested) === 0);
  pushNumberMatcher(L, "IsOriginalRace", session, (card, requested) => ((card.data.race ?? 0) & requested) !== 0);
  pushNumberMatcher(L, "IsNotOriginalRace", session, (card, requested) => ((card.data.race ?? 0) & requested) === 0);
  pushNumberGetter(L, "GetAttribute", session, (card) => card?.data.attribute ?? 0);
  pushNumberGetter(L, "GetOriginalAttribute", session, (card) => card?.data.attribute ?? 0);
  pushNumberMatcher(L, "IsAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) !== 0);
  pushNumberMatcher(L, "IsNotAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) === 0);
  pushNumberMatcher(L, "IsOriginalAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) !== 0);
  pushNumberMatcher(L, "IsNotOriginalAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) === 0);
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
  pushNumberGetter(L, "GetEquipCount", session, (card) => (card ? equippedCards(session, card.uid).length : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card ? equippedCards(session, card.uid).map((equip) => equip.uid) : []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetEquipGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (!card?.equippedToUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, card.equippedToUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetEquipTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckRemoveOverlayCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckRemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAddCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("AddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("RemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanAddCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanAddCounter"));
  pushBooleanGetter(L, "HasCounter", session, (card) => Boolean(card && totalCounters(card) > 0));
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
  pushBooleanGetter(L, "IsPublic", session, (card) => Boolean(card && (card.faceUp || card.location === "graveyard" || card.location === "banished")));
  pushBooleanGetter(L, "IsOnField", session, (card) => Boolean(card && (card.location === "monsterZone" || card.location === "spellTrapZone")));
  pushBooleanGetter(L, "IsMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1) !== 0));
  pushBooleanGetter(L, "IsSpell", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x2) !== 0));
  pushBooleanGetter(L, "IsTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x4) !== 0));
  pushBooleanGetter(L, "IsSpellTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x6) !== 0));
  pushBooleanGetter(L, "IsMaximumMode", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeSide", session, () => false);
  pushBooleanGetter(L, "IsNotMaximumModeSide", session, () => true);
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
  pushNumberGetter(L, "GetPreviousCode", session, (card) => (card?.previousLocation ? Number(card.code) : 0));
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
  pushNumberMatcher(L, "IsPreviousCode", session, (card, requested) => Boolean(card.previousLocation && cardCodes(card).includes(String(requested))));
  pushNumberMatcher(L, "IsPreviousTypeOnField", session, (card, requested) => Boolean(card.previousLocation && (cardTypeFlags(card) & requested) !== 0));
  pushNumberMatcher(L, "IsPreviousAttackOnField", session, (card, requested) => Boolean(card.previousLocation && (card.data.attack ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousDefenseOnField", session, (card, requested) => Boolean(card.previousLocation && (card.data.defense ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousLevelOnField", session, (card, requested) => Boolean(card.previousLocation && (card.data.level ?? 0) === requested));
  pushNumberMatcher(L, "IsPreviousRankOnField", session, (card, requested) => Boolean(card.previousLocation && cardRank(card) === requested));
  pushNumberMatcher(L, "IsPreviousLinkOnField", session, (card, requested) => Boolean(card.previousLocation && cardLink(card) === requested));
  pushNumberMatcher(L, "IsPreviousRaceOnField", session, (card, requested) => Boolean(card.previousLocation && ((card.data.race ?? 0) & requested) !== 0));
  pushNumberMatcher(L, "IsPreviousAttributeOnField", session, (card, requested) => Boolean(card.previousLocation && ((card.data.attribute ?? 0) & requested) !== 0));
  pushNumberMatcher(L, "IsPreviousSetCard", session, (card, requested) => Boolean(card.previousLocation && card.data.setcodes?.includes(requested)));
  pushNumberGetter(L, "GetReason", session, (card) => card?.reason ?? 0);
  pushNumberMatcher(L, "IsReason", session, (card, requested) => ((card.reason ?? 0) & requested) !== 0);
  pushNumberGetter(L, "GetReasonPlayer", session, (card) => card?.reasonPlayer ?? card?.controller ?? 0);
  pushNumberMatcher(L, "IsReasonPlayer", session, (card, requested) => (card.reasonPlayer ?? card.controller) === normalizePlayer(requested));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const player = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && player !== undefined && card.controller === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsControler"));
  pushCanChangeControler(L, "IsAbleToChangeControler", session);
  pushCanChangeControler(L, "IsControlerCanBeChanged", session);
  pushNumberGetter(L, "GetSummonType", session, (card) => summonTypeMask(card));
  pushNumberMatcher(L, "IsSummonType", session, (card, requested) => isSummonTypeMatch(summonTypeMask(card), requested));
  pushNumberMatcher(L, "IsSummonLocation", session, (card, requested) => Boolean(card.summonType && (locationMaskFromLocation(card.previousLocation) & requested) !== 0));
  pushNumberMatcher(L, "IsSummonPlayer", session, (card, requested) => card.summonPlayer !== undefined && card.summonPlayer === normalizePlayer(requested));
  pushBooleanGetter(L, "IsAbleToGrave", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard")));
  pushBooleanGetter(L, "IsAbleToGraveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToHand", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand")));
  pushBooleanGetter(L, "IsAbleToDeck", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck")));
  pushBooleanGetter(L, "IsAbleToDeckOrExtraAsCost", session, (card, uid) => Boolean(card && uid && canMoveCardToDeckOrExtraAsCost(session.state, card, uid)));
  pushBooleanGetter(L, "IsAbleToRemove", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished")));
  pushBooleanGetter(L, "IsAbleToRemoveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToExtra", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "extraDeck")));
  pushBooleanGetter(L, "IsReleasableByEffect", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.release | duelReason.effect)));
  pushBooleanGetter(L, "IsDestructable", session, (_, uid) => Boolean(uid && canDestroyCard(session.state, uid)));
  pushBooleanGetter(L, "IsDiscardable", session, (card, uid) => Boolean(card && uid && card.location === "hand" && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
  pushBooleanGetter(L, "IsRelateToEffect", session, (card) => Boolean(card));
  pushBooleanGetter(L, "IsRelateToBattle", session, (_, uid) => Boolean(uid && (session.state.currentAttack?.attackerUid === uid || session.state.currentAttack?.targetUid === uid)));
  pushBooleanGetter(L, "IsCanBeEffectTarget", session, (card) => Boolean(card));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsHasEffect"));
  pushBooleanGetter(L, "IsNegatable", session, (card) => Boolean(card && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsNegatableMonster", session, (card) => Boolean(card && isMonsterLike(card) && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsSummonableCard", session, (card) =>
    Boolean(card && normalSummonActions(session.state, card.controller, [card]).some((action) => action.type === "normalSummon" && action.uid === card.uid)),
  );
  pushBooleanGetter(L, "IsSpecialSummonable", session, (card) => Boolean(card && canSpecialSummonDuelCard(session.state, card.uid, card.controller)));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsSynchroSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsSynchroSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const player = lua.lua_isnumber(state, 4) ? normalizePlayer(lua.lua_tointeger(state, 4)) : card?.controller;
    lua.lua_pushboolean(state, Boolean(card && player !== undefined && canSpecialSummonDuelCard(session.state, card.uid, player)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanBeSpecialSummoned"));
  pushBooleanGetter(L, "IsMSetable", session, (card) =>
    Boolean(card && normalSummonActions(session.state, card.controller, [card]).some((action) => action.type === "setMonster" && action.uid === card.uid)),
  );
  pushBooleanGetter(L, "IsCanTurnSet", session, (card) => Boolean(card && canTurnSet(card)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && canChangePosition(session.state, card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanChangePosition"));
  pushBooleanGetter(L, "IsSSetable", session, (card) => Boolean(card && card.location === "hand" && (card.kind === "spell" || card.kind === "trap") && hasZoneSpace(session.state, card.controller, "spellTrapZone")));
  pushMaterialPredicate(L, "IsCanBeFusionMaterial", session, "fusion");
  pushMaterialPredicate(L, "IsCanBeSynchroMaterial", session, "synchro");
  pushMaterialPredicate(L, "IsCanBeXyzMaterial", session, "xyz");
  pushMaterialPredicate(L, "IsCanBeLinkMaterial", session, "link");
  pushMaterialPredicate(L, "IsCanBeRitualMaterial", session, "ritual");
}

function installFlagHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? Math.trunc(lua.lua_tonumber(state, 3)) : 0;
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
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    lua.lua_pushboolean(state, Boolean(uid && getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) >= minimum));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("HasFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, uid ? setDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code, value) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}

function equippedCards(session: DuelSession, uid: string): DuelCardInstance[] {
  return session.state.cards.filter((card) => card.equippedToUid === uid && card.location === "spellTrapZone");
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

function pushMaterialPredicate(L: unknown, fieldName: string, session: DuelSession, kind: MaterialUseKind): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetUid = readCardUid(state, 2);
    const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
    lua.lua_pushboolean(state, canBeMaterial(session.state, card, kind, target));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushCanChangeControler(L: unknown, fieldName: string, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetPlayer = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : card ? otherPlayer(card.controller) : undefined;
    lua.lua_pushboolean(state, Boolean(card && targetPlayer !== undefined && canChangeControl(session.state, card, targetPlayer)));
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

function pushCheckRemoveOverlayCard(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const count = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  lua.lua_pushboolean(L, Boolean(card && card.overlayUids.length >= count));
  return 1;
}

function pushIsHasEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const code = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  if (!card || code === undefined) return 0;
  const effects = matchingLuaEffects(session.state, card, code, hostState);
  if (effects.length === 0) {
    lua.lua_pushnil(L);
    return 1;
  }
  for (const effect of effects) hostState.pushEffectTable(L, effect.id);
  return effects.length;
}

function pushGetCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  lua.lua_pushinteger(L, getDuelCardCounter(card, counterType));
  return 1;
}

function pushAddCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, addDuelCardCounter(card, counterType, count));
  return 1;
}

function pushRemoveCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  lua.lua_pushboolean(L, removeDuelCardCounter(card, counterType, count));
  return 1;
}

function pushIsCanAddCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, canAddDuelCardCounter(card, count));
  return 1;
}

function pushIsSynchroSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const suppliedUids = [...readCardOrGroupUids(L, 2), ...readCardOrGroupUids(L, 3)];
  lua.lua_pushboolean(L, Boolean(card && canLuaSynchroSummonCard(session, card, suppliedUids)));
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

function canBeMaterial(state: DuelState, card: DuelCardInstance | undefined, kind: MaterialUseKind, target?: DuelCardInstance): boolean {
  return Boolean(
    card &&
      isMonsterLike(card) &&
      canBeMaterialFromLocation(card.location, kind) &&
      targetAllowsMaterial(target, card, kind) &&
      !isMaterialUsePrevented(state, card.uid, kind, createMaterialCheckContext(state)),
  );
}

function canDestroyCard(state: DuelState, uid: string): boolean {
  const reason = duelReason.effect | duelReason.destroy;
  return canMoveDuelCardToLocation(state, uid, "graveyard", reason) && !findIndestructibleEffect(state, uid, reason, createMaterialCheckContext(state));
}

function canMoveCardToDeckOrExtraAsCost(state: DuelState, card: DuelCardInstance, uid: string): boolean {
  const destination: DuelLocation = card.kind === "extra" || isPendulumCard(card) ? "extraDeck" : "deck";
  return canMoveDuelCardToLocation(state, uid, destination, duelReason.cost);
}

function isNegatableCard(state: DuelState, card: DuelCardInstance): boolean {
  return card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone") && !isCardDisabled(state, card, createMaterialCheckContext(state));
}

function matchingLuaEffects<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  code: number,
  hostState: LuaCardApiState<EffectRecord>,
): EffectRecord[] {
  const matches: EffectRecord[] = [];
  const seen = new Set<number>();
  for (const luaEffect of hostState.effects.values()) {
    if (luaEffect.code !== code || seen.has(luaEffect.id)) continue;
    const duelEffect = state.effects.find((candidate) => candidate.id === luaEffectDuelId(luaEffect) && candidate.sourceUid === luaEffect.sourceUid);
    const source = duelEffect ? state.cards.find((candidate) => candidate.uid === duelEffect.sourceUid) : undefined;
    if (!duelEffect || !source || !isEffectActiveForCard(duelEffect, luaEffect, source, card, state)) continue;
    seen.add(luaEffect.id);
    matches.push(luaEffect);
  }
  return matches;
}

function luaEffectDuelId(effect: LuaCardApiEffectRecord): string {
  return `lua-${effect.id}${effect.code === undefined ? "" : `-${effect.code}`}`;
}

function isEffectActiveForCard(effect: DuelEffectDefinition, luaEffect: LuaCardApiEffectRecord, source: DuelCardInstance, card: DuelCardInstance, state: DuelState): boolean {
  if (!effect.range.includes(source.location)) return false;
  if (!continuousEffectAffectsCard(effect, luaEffect, source, card)) return false;
  return !effect.canActivate || effect.canActivate(createMaterialCheckContext(state)(effect, source, card));
}

function continuousEffectAffectsCard(effect: DuelEffectDefinition, luaEffect: LuaCardApiEffectRecord, source: DuelCardInstance, card: DuelCardInstance): boolean {
  if (source.uid === card.uid) return true;
  if (((luaEffect.typeFlags ?? 0) & 0x1) !== 0) return false;
  if ((effect.property ?? 0) === 0 || ((effect.property ?? 0) & 0x800) === 0) return source.controller === card.controller;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  return source.controller === card.controller ? selfTarget !== 0 : opponentTarget !== 0;
}

function canChangeControl(state: DuelState, card: DuelCardInstance, targetPlayer: PlayerId): boolean {
  if (card.controller === targetPlayer) return false;
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  return hasZoneSpace(state, targetPlayer, card.location);
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
}

function totalCounters(card: DuelCardInstance): number {
  return Object.values(card.counters ?? {}).reduce((total, count) => total + Math.max(0, count), 0);
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1000000) !== 0;
}

function canBeMaterialFromLocation(location: DuelLocation, kind: MaterialUseKind): boolean {
  if (kind === "fusion" || kind === "ritual") return location === "hand" || location === "monsterZone";
  return location === "monsterZone";
}

function targetAllowsMaterial(target: DuelCardInstance | undefined, card: DuelCardInstance, kind: MaterialUseKind): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const codes = cardCodes(card);
  if (kind === "fusion") return !target.data.fusionMaterials?.length || target.data.fusionMaterials.some((code) => codes.includes(code));
  if (kind === "ritual") return !target.data.ritualMaterials?.length || target.data.ritualMaterials.some((code) => codes.includes(code));
  if (kind === "synchro") {
    const materials = target.data.synchroMaterials;
    if (materials) return [materials.tuner, ...materials.nonTuners].some((code) => codes.includes(code));
    const targetLevel = cardTypeFlags(target) & 0x2000 ? target.data.level ?? 0 : 0;
    const materialLevel = card.data.level ?? 0;
    return targetLevel > 0 && materialLevel > 0 && materialLevel < targetLevel;
  }
  if (kind === "xyz") return !target.data.xyzMaterials?.length ? cardRank(target) === (card.data.level ?? 0) : target.data.xyzMaterials.some((code) => codes.includes(code));
  if (kind === "link") return !target.data.linkMaterials?.length ? cardLink(target) > 0 && linkMaterialRating(card) <= cardLink(target) : target.data.linkMaterials.some((code) => codes.includes(code));
  return true;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function linkMaterialRating(card: DuelCardInstance): number {
  return cardLink(card) || 1;
}

function createMaterialCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: card ? [card.uid] : [],
    log() {},
    moveCard(uid: string, to: DuelLocation, controller?: PlayerId) {
      return moveDuelCard(state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return card ? [card] : [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function readCard(L: unknown, session: DuelSession | undefined): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid && session ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function cardTypeFlags(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
}

function canTurnSet(card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || !card.faceUp) return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return (cardTypeFlags(card) & 0x4000000) === 0;
}

function canChangePosition(state: DuelState, card: DuelCardInstance, requested: CardPosition | undefined): boolean {
  if (requested) return canChangeDuelCardPosition(state, card.uid, requested);
  if (card.position === "faceUpAttack") return canChangeDuelCardPosition(state, card.uid, "faceUpDefense");
  if (card.position === "faceUpDefense" || card.position === "faceDownDefense") return canChangeDuelCardPosition(state, card.uid, "faceUpAttack");
  return false;
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
  "GetOriginalCodeRule",
  "IsCode",
  "IsNotCode",
  "IsOriginalCode",
  "IsOriginalCodeRule",
  "IsSetCard",
  "IsNotSetCard",
  "GetOwner",
  "IsOwner",
  "GetControler",
  "GetType",
  "GetOriginalType",
  "IsType",
  "IsNotType",
  "IsOriginalType",
  "IsNotOriginalType",
  "GetAttack",
  "GetBaseAttack",
  "HasNonZeroAttack",
  "IsAttack",
  "IsOriginalAttack",
  "IsAttackAbove",
  "IsAttackBelow",
  "IsOriginalAttackAbove",
  "IsOriginalAttackBelow",
  "GetDefense",
  "GetBaseDefense",
  "IsDefense",
  "IsOriginalDefense",
  "IsDefenseAbove",
  "IsDefenseBelow",
  "IsOriginalDefenseAbove",
  "IsOriginalDefenseBelow",
  "GetLevel",
  "HasLevel",
  "GetOriginalLevel",
  "IsLevel",
  "IsLevelAbove",
  "IsLevelBelow",
  "IsOriginalLevel",
  "IsOriginalLevelAbove",
  "IsOriginalLevelBelow",
  "GetRank",
  "GetOriginalRank",
  "IsRank",
  "IsRankAbove",
  "IsRankBelow",
  "IsOriginalRank",
  "IsOriginalRankAbove",
  "IsOriginalRankBelow",
  "GetLink",
  "GetOriginalLink",
  "IsLink",
  "IsLinkAbove",
  "IsLinkBelow",
  "IsOriginalLink",
  "IsOriginalLinkAbove",
  "IsOriginalLinkBelow",
  "GetLinkMarker",
  "GetRace",
  "GetOriginalRace",
  "IsRace",
  "IsNotRace",
  "IsOriginalRace",
  "IsNotOriginalRace",
  "GetAttribute",
  "GetOriginalAttribute",
  "IsAttribute",
  "IsNotAttribute",
  "IsOriginalAttribute",
  "IsNotOriginalAttribute",
  "IsFaceup",
  "IsFacedown",
  "GetLocation",
  "GetSequence",
  "GetPosition",
  "GetOverlayCount",
  "GetOverlayGroup",
  "GetEquipCount",
  "GetEquipGroup",
  "GetEquipTarget",
  "RemoveOverlayCard",
  "CheckRemoveOverlayCard",
  "GetCounter",
  "AddCounter",
  "RemoveCounter",
  "IsCanAddCounter",
  "HasCounter",
  "IsPosition",
  "IsAttackPos",
  "IsDefensePos",
  "IsPublic",
  "IsOnField",
  "IsMonster",
  "IsSpell",
  "IsTrap",
  "IsLocation",
  "GetPreviousLocation",
  "GetPreviousSequence",
  "GetPreviousPosition",
  "GetPreviousCode",
  "GetPreviousTypeOnField",
  "GetPreviousAttackOnField",
  "GetPreviousDefenseOnField",
  "GetPreviousLevelOnField",
  "GetPreviousRankOnField",
  "GetPreviousLinkOnField",
  "GetPreviousRaceOnField",
  "GetPreviousAttributeOnField",
  "WasFaceup",
  "WasFacedown",
  "IsPreviousLocation",
  "IsPreviousPosition",
  "GetPreviousControler",
  "IsPreviousControler",
  "IsPreviousCode",
  "IsPreviousTypeOnField",
  "IsPreviousAttackOnField",
  "IsPreviousDefenseOnField",
  "IsPreviousLevelOnField",
  "IsPreviousRankOnField",
  "IsPreviousLinkOnField",
  "IsPreviousRaceOnField",
  "IsPreviousAttributeOnField",
  "IsPreviousSetCard",
  "GetReason",
  "IsReason",
  "GetReasonPlayer",
  "IsReasonPlayer",
  "IsControler",
  "IsAbleToChangeControler",
  "IsControlerCanBeChanged",
  "GetSummonType",
  "IsSummonType",
  "IsSummonLocation",
  "IsSummonPlayer",
  "IsAbleToGrave",
  "IsAbleToGraveAsCost",
  "IsAbleToHand",
  "IsAbleToDeck",
  "IsAbleToDeckOrExtraAsCost",
  "IsAbleToRemove",
  "IsAbleToRemoveAsCost",
  "IsAbleToExtra",
  "IsReleasableByEffect",
  "IsDestructable",
  "IsDiscardable",
  "IsRelateToEffect",
  "IsRelateToBattle",
  "IsCanBeEffectTarget",
  "IsHasEffect",
  "IsNegatable",
  "IsNegatableMonster",
  "IsSummonableCard",
  "IsSpecialSummonable",
  "IsSynchroSummonable",
  "IsCanBeSpecialSummoned",
  "IsMSetable",
  "IsCanTurnSet",
  "IsCanChangePosition",
  "IsSSetable",
  "IsSpellTrap",
  "IsMaximumMode",
  "IsMaximumModeCenter",
  "IsMaximumModeSide",
  "IsNotMaximumModeSide",
  "IsCanBeFusionMaterial",
  "IsCanBeSynchroMaterial",
  "IsCanBeXyzMaterial",
  "IsCanBeLinkMaterial",
  "IsCanBeRitualMaterial",
  "RegisterFlagEffect",
  "GetFlagEffect",
  "HasFlagEffect",
  "GetFlagEffectLabel",
  "SetFlagEffectLabel",
  "ResetFlagEffect",
];
