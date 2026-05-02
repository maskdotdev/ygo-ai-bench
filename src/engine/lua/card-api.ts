import fengari from "fengari";
import { hasZoneSpace, pushDuelLog } from "#duel/card-state.js";
import { canChangeDuelCardPosition, canDuelCardAttack, canMoveDuelCardToLocation, detachDuelOverlayMaterials, moveDuelCard, registerEffect } from "#duel/core.js";
import { isCardDisabled, type MaterialUseKind } from "#duel/continuous-effects.js";
import { addDuelCardCounter, canAddDuelCardCounter, getDuelCardCounter, removeDuelCardCounter } from "#duel/counters.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import { installCardBattleApi } from "#lua/card-battle-api.js";
import { installCardCodeApi } from "#lua/card-code-api.js";
import { installCardColumnApi } from "#lua/card-column-api.js";
import { cardCodes, readRequestedNumbers } from "#lua/card-code-utils.js";
import { canBeMaterial, canMoveCardToDeckOrExtraAsCost, isMonsterLike } from "#lua/card-eligibility-api.js";
import { createLuaMaterialCheckContext, installCardEffectQueryApi, isNegatableCard, matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { installCardFlagApi } from "#lua/card-flag-api.js";
import { installCardLinkApi } from "#lua/card-link-api.js";
import { installCardPreviousStateApi } from "#lua/card-previous-state-api.js";
import { installCardReasonApi } from "#lua/card-reason-api.js";
import { installCardRelationApi } from "#lua/card-relation-api.js";
import { installCardRushApi } from "#lua/card-rush-api.js";
import { cardLink, cardRank, cardTypeFlags, installCardStatApi } from "#lua/card-stat-api.js";
import { installCardSummonApi } from "#lua/card-summon-api.js";
import { installCardSummonPredicateApi } from "#lua/card-summon-predicate-api.js";
import { installCardTableApi, pushCardTable } from "#lua/card-table-api.js";
import { linkedGroupUidsForCard, linkedZoneMask } from "#lua/duel-api/location.js";
import { pushGroupTable } from "#lua/group-api.js";
import { canLuaLinkSummonCard, readLinkMaterialArguments } from "#lua/link-summonable.js";
import { canLuaSynchroSummonCard } from "#lua/synchro-summonable.js";
import { canLuaXyzSummonCard } from "#lua/xyz-summonable.js";
import {
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readGroupUids,
  readTableNumberField,
  readTableStringField,
} from "#lua/api-utils.js";
import type { CardPosition, DuelCardInstance, DuelEffectDefinition, DuelPhase, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
export { pushCardTable } from "#lua/card-table-api.js";

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
  installCardTableApi(L);
  installCardCodeApi(L, session);
  installCardStatApi(L, session);
  installCardBattleApi(L, session);
  installCardLinkApi(L, session);
  installCardReasonApi(L, session, hostState);
  installEffectBackedStatHelpers(L, session, hostState);
  installStateHelpers(L, session, hostState);
  installCardFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Card"));
}

function installEffectBackedStatHelpers<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushRitualLevel(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetRitualLevel"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSynchroLevel(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetSynchroLevel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const status = card ? cardStatusMask(session.state, card) : 0;
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => (status & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsStatus"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetStatus(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetStatus"));
}

function installStateHelpers<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
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
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.sequence)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSequence"));
  pushNumberMatcher(L, "IsFieldID", session, (card, requested) => cardFieldId(card) === requested);
  pushNumberMatcher(L, "IsRealFieldID", session, (card, requested) => cardFieldId(card) === requested);
  pushNumberGetter(L, "GetPosition", session, (card) => positionMaskFromPosition(card?.position));
  pushNumberGetter(L, "GetOverlayCount", session, (card) => card?.overlayUids.length ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card?.overlayUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOverlayGroup"));
  pushNumberGetter(L, "GetEquipCount", session, (card) => (card ? equippedCards(session, card.uid).length : 0));
  pushBooleanGetter(L, "HasEquipCard", session, (card) => Boolean(card && equippedCards(session, card.uid).length > 0));
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
  lua.lua_pushcfunction(L, (state: unknown) => pushEquipByEffectAndLimitRegister(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("EquipByEffectAndLimitRegister"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEquipByEffectLimit(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("EquipByEffectLimit"));
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
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanRemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushHasCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("HasCounter"));
  pushBooleanGetter(L, "HasCounters", session, (card) => Boolean(card && totalCounters(card) > 0));
  pushBooleanGetter(L, "IsFaceup", session, (card) => Boolean(card?.faceUp));
  pushBooleanGetter(L, "IsFacedown", session, (card) => Boolean(card && !card.faceUp));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requestedPosition = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && (positionMaskFromPosition(card.position) & requestedPosition) !== 0));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPosition"));
  pushBooleanGetter(L, "IsAttackPos", session, (card) => Boolean(card && card.position === "faceUpAttack"));
  pushBooleanGetter(L, "IsDefensePos", session, (card) => Boolean(card && (card.position === "faceUpDefense" || card.position === "faceDownDefense")));
  pushBooleanGetter(L, "IsPublic", session, (card) => Boolean(card && (card.faceUp || card.location === "graveyard")));
  pushBooleanGetter(L, "IsOnField", session, (card) => Boolean(card && (card.location === "monsterZone" || card.location === "spellTrapZone")));
  pushZonePredicate(L, "IsInMainMZone", session, (card) => card.location === "monsterZone" && card.sequence >= 0 && card.sequence <= 4);
  pushZonePredicate(L, "IsInExtraMZone", session, (card) => card.location === "monsterZone" && card.sequence >= 5 && card.sequence <= 6);
  pushBooleanGetter(L, "CanAttack", session, (card) => Boolean(card && canDuelCardAttack(session.state, card.uid)));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanChainAttack(state, session));
  lua.lua_setfield(L, -2, to_luastring("CanChainAttack"));
  pushNumberGetter(L, "GetAttackAnnouncedCount", session, (card) => (card ? session.state.attacksDeclared.filter((uid) => uid === card.uid).length : 0));
  pushBooleanGetter(L, "CanGetPiercingRush", session, (card) => Boolean(card && canGetPiercingRush(session.state, card, hostState)));
  installCardRushApi(L, session, hostState);
  pushBooleanGetter(L, "IsMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1) !== 0));
  pushBooleanGetter(L, "IsMonsterCard", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1) !== 0));
  pushBooleanGetter(L, "IsNotTuner", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1000) === 0));
  pushBooleanGetter(L, "IsSpell", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x2) !== 0));
  pushBooleanGetter(L, "IsSpellCard", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x2) !== 0));
  pushBooleanGetter(L, "IsTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x4) !== 0));
  pushBooleanGetter(L, "IsSpellTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x6) !== 0));
  pushBooleanGetter(L, "IsSpellTrapCard", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x6) !== 0));
  pushBooleanGetter(L, "IsSpirit", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x200000) !== 0));
  pushBooleanGetter(L, "IsActionCard", session, (card) => (cardTypeFlags(card) & 0x10000000) !== 0 && (cardTypeFlags(card) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionSpell", session, (card) => (cardTypeFlags(card) & 0x10000002) === 0x10000002 && (cardTypeFlags(card) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionTrap", session, (card) => (cardTypeFlags(card) & 0x10000004) === 0x10000004 && (cardTypeFlags(card) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionField", session, (card) => (cardTypeFlags(card) & 0x10080000) === 0x10080000);
  pushBooleanGetter(L, "IsEquipCard", session, (card) => (cardTypeFlags(card) & 0x40000) !== 0);
  pushBooleanGetter(L, "IsEquipSpell", session, (card) => cardTypeFlags(card) === 0x40002);
  pushBooleanGetter(L, "IsEquipTrap", session, (card) => (cardTypeFlags(card) & 0x40004) === 0x40004);
  pushBooleanGetter(L, "IsFieldSpell", session, (card) => (cardTypeFlags(card) & 0x80002) === 0x80002);
  pushBooleanGetter(L, "IsLinkSpell", session, (card) => cardTypeFlags(card) === 0x4000002);
  pushBooleanGetter(L, "IsNormalSpell", session, (card) => cardTypeFlags(card) === 0x2);
  pushBooleanGetter(L, "IsNormalTrap", session, (card) => cardTypeFlags(card) === 0x4);
  pushBooleanGetter(L, "IsNormalSpellTrap", session, (card) => cardTypeFlags(card) === 0x2 || cardTypeFlags(card) === 0x4);
  pushBooleanGetter(L, "IsCounterTrap", session, (card) => (cardTypeFlags(card) & 0x100004) === 0x100004);
  pushBooleanGetter(L, "IsContinuousSpell", session, (card) => (cardTypeFlags(card) & 0x20002) === 0x20002);
  pushBooleanGetter(L, "IsRitualSpell", session, (card) => (cardTypeFlags(card) & 0x82) === 0x82);
  pushBooleanGetter(L, "IsContinuousTrap", session, (card) => (cardTypeFlags(card) & 0x20004) === 0x20004);
  pushBooleanGetter(L, "IsContinuousSpellTrap", session, (card) => (cardTypeFlags(card) & 0x20000) !== 0 && (cardTypeFlags(card) & 0x6) !== 0);
  pushBooleanGetter(L, "IsFusionMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x41) === 0x41));
  pushBooleanGetter(L, "IsRitualMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x81) === 0x81));
  pushBooleanGetter(L, "IsSynchroMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x2001) === 0x2001));
  pushBooleanGetter(L, "IsXyzMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x800001) === 0x800001));
  pushBooleanGetter(L, "IsPendulumMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1000001) === 0x1000001));
  pushBooleanGetter(L, "IsEffectMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x21) === 0x21));
  pushBooleanGetter(L, "IsNonEffectMonster", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x1) !== 0 && (cardTypeFlags(card) & 0x20) === 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const monsterType = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    if (card) card.data.typeFlags = 0x1 | monsterType;
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("AddMonsterAttribute"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("AddMonsterAttributeComplete"));
  pushBooleanGetter(L, "IsLinked", session, (card) => Boolean(card && isLinkedMonsterZoneCard(session.state, card)));
  pushNumberGetter(L, "GetLinkedZone", session, (card) => (card ? linkedZoneMask(card) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card ? linkedGroupUidsForCard(session, card) : []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedGroup"));
  pushNumberGetter(L, "GetLinkedGroupCount", session, (card) => (card ? linkedGroupUidsForCard(session, card).length : 0));
  pushBooleanGetter(L, "IsDrone", session, (card) => Boolean(card?.data.setcodes?.includes(0x581)));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRikkaReleasable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsRikkaReleasable"));
  pushBooleanGetter(L, "IsForbidden", session, () => false);
  pushBooleanGetter(L, "IsDisabled", session, (card) => Boolean(card && isCardDisabled(session.state, card, createLuaMaterialCheckContext(session.state))));
  pushBooleanGetter(L, "CheckAdjacent", session, (card) => Boolean(card && hasAdjacentMonsterZone(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectAdjacent(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectAdjacent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveAdjacent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveAdjacent"));
  pushBooleanGetter(L, "IsMaximumMode", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeLeft", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeRight", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeSide", session, () => false);
  pushBooleanGetter(L, "IsNotMaximumModeSide", session, () => true);
  pushBooleanGetter(L, "WasMaximumMode", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeSide", session, () => false);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && locationsFromMask(locationMask).includes(card.location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLocation"));
  installCardPreviousStateApi(L, session);
  installCardColumnApi(L, session);
  pushNumberGetter(L, "GetReason", session, (card) => card?.reason ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => ((card.reason ?? 0) & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsReason"));
  pushNumberGetter(L, "GetReasonPlayer", session, (card) => card?.reasonPlayer ?? card?.controller ?? 0);
  pushPlayerMatcher(L, "IsReasonPlayer", session, (card, requested) => requested.includes(card.reasonPlayer ?? card.controller));
  pushNumberGetter(L, "GetTurnID", session, (card) => card?.turnId ?? 0);
  pushNumberGetter(L, "GetTurnCounter", session, (card) => card?.turnCounter ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => pushSetTurnCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetTurnCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedPlayers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.controller)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsControler"));
  pushCanChangeControler(L, "IsAbleToChangeControler", session);
  pushCanChangeControler(L, "IsControlerCanBeChanged", session);
  installCardSummonApi(L, session);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const summonLocation = locationMaskFromLocation(card?.previousLocation);
    lua.lua_pushboolean(state, Boolean(card?.summonType && requested.some((value) => (summonLocation & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonLocation"));
  pushPlayerMatcher(L, "IsSummonPlayer", session, (card, requested) => card.summonPlayer !== undefined && requested.includes(card.summonPlayer));
  pushBooleanGetter(L, "IsAbleToGrave", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard")));
  pushBooleanGetter(L, "IsAbleToGraveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToHand", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand")));
  pushBooleanGetter(L, "IsAbleToHandAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToDeck", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck")));
  pushBooleanGetter(L, "IsAbleToDeckAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToDeckOrExtraAsCost", session, (card, uid) => Boolean(card && uid && canMoveCardToDeckOrExtraAsCost(session.state, card, uid)));
  pushBooleanGetter(L, "IsAbleToRemove", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished")));
  pushBooleanGetter(L, "IsAbleToRemoveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToExtra", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "extraDeck")));
  pushBooleanGetter(L, "IsReleasable", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.release | duelReason.cost)));
  pushBooleanGetter(L, "IsReleasableByEffect", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.release | duelReason.effect)));
  pushBooleanGetter(L, "IsDiscardable", session, (card, uid) => Boolean(card && uid && card.location === "hand" && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
  installCardRelationApi(L, session, hostState);
  pushBooleanGetter(L, "IsRelateToBattle", session, (_, uid) => Boolean(uid && isRelatedToBattle(session.state, uid)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (card) card.cancelToGrave = lua.lua_isnoneornil(state, 2) ? true : lua.lua_toboolean(state, 2);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("CancelToGrave"));
  installCardEffectQueryApi(L, session, hostState);
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsHasEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetCardEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const effect = card ? [...hostState.effects.values()].find((candidate) => candidate.sourceUid === card.uid && ((candidate.typeFlags ?? 0) & 0x10) !== 0) : undefined;
    if (!effect) lua.lua_pushnil(state);
    else hostState.pushEffectTable(state, effect.id);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetActivateEffect"));
  pushBooleanGetter(L, "IsNegatable", session, (card) => Boolean(card && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsNegatableMonster", session, (card) => Boolean(card && isMonsterLike(card) && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsNegatableSpellTrap", session, (card) => Boolean(card && (cardTypeFlags(card) & 0x6) !== 0 && isNegatableCard(session.state, card)));
  installCardSummonPredicateApi(L, session);
  lua.lua_pushcfunction(L, (state: unknown) => pushIsSynchroSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsSynchroSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsXyzSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsXyzSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsLinkSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsLinkSummonable"));
  pushBooleanGetter(L, "IsCanTurnSet", session, (card) => Boolean(card && canTurnSet(card)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && canChangePosition(session.state, card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanChangePosition"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && canChangePosition(session.state, card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanChangePositionRush"));
  pushBooleanGetter(L, "IsSSetable", session, (card) => Boolean(card && canLuaSetSpellTrap(card) && hasZoneSpace(session.state, card.controller, "spellTrapZone")));
  pushMaterialPredicate(L, "IsCanBeFusionMaterial", session, "fusion");
  pushMaterialPredicate(L, "IsCanBeSynchroMaterial", session, "synchro");
  pushMaterialPredicate(L, "IsCanBeXyzMaterial", session, "xyz");
  pushMaterialPredicate(L, "IsCanBeLinkMaterial", session, "link");
  pushMaterialPredicate(L, "IsCanBeRitualMaterial", session, "ritual");
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (card) card.summonMaterialUids = readCardOrGroupUids(state, 2);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetMaterial"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("CompleteProcedure"));
}

function canLuaSetSpellTrap(card: DuelCardInstance): boolean {
  return (card.kind === "spell" || card.kind === "trap") && (card.location === "hand" || card.location === "deck" || card.location === "graveyard");
}

function equippedCards(session: DuelSession, uid: string): DuelCardInstance[] {
  return session.state.cards.filter((card) => card.equippedToUid === uid && card.location === "spellTrapZone");
}

export function cardFieldId(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  let value = 0x811c9dc5;
  for (let index = 0; index < card.uid.length; index += 1) {
    value ^= card.uid.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value & 0x7fffffff;
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

function pushSetStatus(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const mask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || mask === 0) return 0;
  const current = card.customStatusMask ?? 0;
  card.customStatusMask = lua.lua_isnoneornil(L, 3) || lua.lua_toboolean(L, 3) ? current | mask : current & ~mask;
  return 0;
}

function pushSetTurnCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  if (card) card.turnCounter = lua.lua_isnumber(L, 2) ? Math.max(0, lua.lua_tointeger(L, 2)) : 0;
  return 0;
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

function pushZonePredicate(L: unknown, fieldName: string, session: DuelSession, predicate: (card: DuelCardInstance) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const player = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && predicate(card) && (player === undefined || card.controller === player)));
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

function pushEquipByEffectAndLimitRegister<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const target = readCard(L, session);
  const player = lua.lua_isnumber(L, 3) ? normalizePlayer(lua.lua_tointeger(L, 3)) : target?.controller ?? session.state.turnPlayer;
  const equipUid = readCardUid(L, 4);
  const equip = equipUid ? session.state.cards.find((candidate) => candidate.uid === equipUid) : undefined;
  const code = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : undefined;
  if (!target || !equip || target.location !== "monsterZone" || !hasZoneSpace(session.state, player, "spellTrapZone")) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    moveDuelCard(session.state, equip.uid, "spellTrapZone", player, duelReason.effect, player);
    equip.equippedToUid = target.uid;
    equip.position = "faceUpAttack";
    equip.faceUp = true;
    if (code !== undefined) registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: equip.uid }, code, 0x1fe0000, 0, 0);
    pushDuelLog(session.state, "equip", player, equip.name, `Equipped to ${target.name}`);
    setOperatedUids(hostState, [equip.uid]);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
}

function pushEquipByEffectLimit<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const effectId = readTableNumberField(L, 1, "__effect_id");
  const cardUid = readCardUid(L, 2);
  const effect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
  if (!effect || !card || effect.sourceUid !== cardUid) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const matches = effect.labelObjectId !== undefined && matchingLuaEffects(session.state, card, 89785855, hostState).some((candidate) => candidate.id === effect.labelObjectId);
  lua.lua_pushboolean(L, matches);
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

function pushRitualLevel<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  if (!card) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const ritualTargetUid = readCardUid(L, 2);
  const ritualTarget = ritualTargetUid ? session.state.cards.find((candidate) => candidate.uid === ritualTargetUid) : undefined;
  const effect = matchingLuaEffects(session.state, card, 241, hostState)[0];
  lua.lua_pushinteger(L, effect ? ritualLevelFromEffect(L, effect, card, ritualTarget, hostState) : card.data.level ?? 0);
  return 1;
}

function pushSynchroLevel<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  if (!card) return lua.lua_pushinteger(L, 0), 1;
  const syncTargetUid = readCardUid(L, 2);
  const syncTarget = syncTargetUid ? session.state.cards.find((candidate) => candidate.uid === syncTargetUid) : undefined;
  const effect = matchingLuaEffects(session.state, card, 240, hostState)[0];
  lua.lua_pushinteger(L, effect ? synchroLevelFromEffect(L, effect, syncTarget, hostState) : card.data.level ?? 0);
  return 1;
}
function ritualLevelFromEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, effect: EffectRecord, card: DuelCardInstance, ritualTarget: DuelCardInstance | undefined, hostState: LuaCardApiState<EffectRecord>): number {
  if (effect.valueRef !== undefined) {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
    hostState.pushEffectTable(L, effect.id);
    pushCardTable(L, card.uid);
    if (ritualTarget) pushCardTable(L, ritualTarget.uid);
    else lua.lua_pushnil(L);
    const status = lua.lua_pcall(L, 3, 1, 0);
    if (status === lua.LUA_OK) {
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : card.data.level ?? 0;
      lua.lua_pop(L, 1);
      return value;
    }
    lua.lua_pop(L, 1);
  }
  return effect.value ?? card.data.level ?? 0;
}
function synchroLevelFromEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, effect: EffectRecord, syncTarget: DuelCardInstance | undefined, hostState: LuaCardApiState<EffectRecord>): number {
  if (effect.valueRef === undefined) return effect.value ?? 0;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
  hostState.pushEffectTable(L, effect.id);
  syncTarget ? pushCardTable(L, syncTarget.uid) : lua.lua_pushnil(L);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) return lua.lua_pop(L, 1), 0;
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
  lua.lua_pop(L, 1);
  return value;
}

function pushGetCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  lua.lua_pushinteger(L, getDuelCardCounter(card, counterType));
  return 1;
}

function pushHasCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  if (!card) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  if (!lua.lua_isnumber(L, 2)) {
    lua.lua_pushboolean(L, totalCounters(card) > 0);
    return 1;
  }
  lua.lua_pushboolean(L, getDuelCardCounter(card, lua.lua_tointeger(L, 2)) > 0);
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

function pushIsCanRemoveCounter(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  lua.lua_pushboolean(L, getDuelCardCounter(card, counterType) >= Math.max(0, count));
  return 1;
}

function pushIsSynchroSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const suppliedUids = [...readCardOrGroupUids(L, 2), ...readCardOrGroupUids(L, 3)];
  lua.lua_pushboolean(L, Boolean(card && canLuaSynchroSummonCard(session, card, suppliedUids)));
  return 1;
}

function pushIsXyzSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const suppliedUids = [...readCardOrGroupUids(L, 2), ...readCardOrGroupUids(L, 3)];
  lua.lua_pushboolean(L, Boolean(card && canLuaXyzSummonCard(session, card, suppliedUids)));
  return 1;
}

function pushIsLinkSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const { requiredUids, materialGroupUids, min, max } = readLinkMaterialArguments(L);
  lua.lua_pushboolean(L, Boolean(card && canLuaLinkSummonCard(session, card, requiredUids, materialGroupUids, min, max)));
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

function canChangeControl(state: DuelState, card: DuelCardInstance, targetPlayer: PlayerId): boolean {
  if (card.controller === targetPlayer) return false;
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  return hasZoneSpace(state, targetPlayer, card.location);
}

function totalCounters(card: DuelCardInstance): number {
  return Object.values(card.counters ?? {}).reduce((total, count) => total + Math.max(0, count), 0);
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1000000) !== 0;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function isLinkedMonsterZoneCard(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || !card.faceUp) return false;
  return monsterZoneCards(state).some((candidate) => {
    if (candidate.uid === card.uid || !candidate.faceUp) return false;
    return linkPointsTo(candidate, card) || linkPointsTo(card, candidate);
  });
}

function canEnterBattlePhase(state: DuelState): boolean {
  return nextAvailablePhase(state, state.turnPlayer) === "battle";
}

function canGetPiercingRush<EffectRecord extends LuaCardApiEffectRecord>(state: DuelState, card: DuelCardInstance, hostState: LuaCardApiState<EffectRecord>): boolean {
  if ((cardTypeFlags(card) & 0x1) === 0 || !canEnterBattlePhase(state)) return false;
  if (matchingLuaEffects(state, card, 85, hostState).length > 0) return false;
  const pierceEffects = matchingLuaEffects(state, card, 203, hostState);
  return pierceEffects.length === 0 || pierceEffects.some((effect) => (effect.reset?.flags ?? 0) === 0);
}

function pushIsRikkaReleasable<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const player = normalizePlayer(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : session.state.turnPlayer);
  lua.lua_pushboolean(L, Boolean(card && isRikkaReleasable(session.state, card, player, hostState)));
  return 1;
}

function isRikkaReleasable<EffectRecord extends LuaCardApiEffectRecord>(state: DuelState, card: DuelCardInstance, player: PlayerId, hostState: LuaCardApiState<EffectRecord>): boolean {
  if (((card.data.race ?? 0) & 0x400) !== 0) return true;
  return card.controller === otherPlayer(player) && matchingLuaEffects(state, card, 76869711, hostState).length > 0;
}

function pushSelectAdjacent(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const sequence = firstOpenAdjacentMonsterSequence(session.state, card);
  if (sequence === undefined) {
    lua.lua_pushnil(L);
    return 1;
  }
  lua.lua_pushinteger(L, sequence);
  return 1;
}

function pushMoveAdjacent<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const sequence = firstOpenAdjacentMonsterSequence(session.state, card);
  if (!card || sequence === undefined) return 0;
  card.sequence = sequence;
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, card.uid);
  return 0;
}

function firstOpenAdjacentMonsterSequence(state: DuelState, card: DuelCardInstance | undefined): number | undefined {
  if (!card || card.location !== "monsterZone" || card.sequence < 0 || card.sequence > 4) return undefined;
  for (const sequence of [card.sequence - 1, card.sequence + 1]) {
    if (sequence >= 0 && sequence <= 4 && isMonsterSequenceOpen(state, card.controller, sequence)) return sequence;
  }
  return undefined;
}

function isMonsterSequenceOpen(state: DuelState, player: PlayerId, sequence: number): boolean {
  return !state.cards.some((card) => card.controller === player && card.location === "monsterZone" && card.sequence === sequence);
}

function nextAvailablePhase(state: DuelState, player: PlayerId): DuelPhase | undefined {
  const phaseOrder = ["draw", "standby", "main1", "battle", "main2", "end"] satisfies DuelPhase[];
  for (const phase of phaseOrder.slice(phaseOrder.indexOf(state.phase) + 1)) {
    if (!state.skippedPhases.some((skip) => skip.player === player && skip.phase === phase && skip.remaining > 0)) return phase;
  }
  return undefined;
}

function monsterZoneCards(state: DuelState): DuelCardInstance[] {
  return state.cards.filter((card) => card.location === "monsterZone");
}

function linkPointsTo(source: DuelCardInstance, target: DuelCardInstance): boolean {
  if (source.controller !== target.controller || cardLink(source) <= 0) return false;
  return linkedSequences(source.sequence, source.data.linkMarkers ?? 0).includes(target.sequence);
}

function linkedSequences(sequence: number, markers: number): number[] {
  const sequences: number[] = [];
  if ((markers & 0x8) !== 0) sequences.push(sequence - 1);
  if ((markers & 0x20) !== 0) sequences.push(sequence + 1);
  if ((markers & 0x1) !== 0 || (markers & 0x2) !== 0 || (markers & 0x4) !== 0) sequences.push(sequence);
  return sequences.filter((target) => target >= 0 && target <= 6);
}

function readCard(L: unknown, session: DuelSession | undefined): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid && session ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function readRequestedCodes(L: unknown, startIndex: number): string[] {
  const codes: string[] = [];
  for (let index = startIndex; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) codes.push(String(lua.lua_tointeger(L, index)));
  }
  return codes;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function readRequestedPlayers(L: unknown, startIndex: number): PlayerId[] {
  return readRequestedNumbers(L, startIndex).map(normalizePlayer);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function cardStatusMask(state: DuelState, card: DuelCardInstance): number {
  let mask = card.customStatusMask ?? 0;
  if (isCardDisabled(state, card, createLuaMaterialCheckContext(state))) mask |= 0x1;
  if (card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone")) mask |= 0x400;
  if ((card.data.level ?? 0) <= 0 && cardRank(card) === 0 && cardLink(card) === 0 && isMonsterLike(card)) mask |= 0x20;
  if (card.summonType === "normal" || card.summonType === "tribute") mask |= 0x800;
  if (card.summonType === "flip") mask |= 0x20000000;
  if (card.summonType && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip") mask |= 0x40000000;
  if (card.summonType) mask |= 0x8;
  if ((card.reason ?? 0) & duelReason.battle) mask |= 0x4000;
  if (state.attackCanceledUids.includes(card.uid)) mask |= 0x200000;
  if (isOpposingMonsterBattle(state, card.uid)) mask |= 0x10000000;
  if (state.chain.some((link) => link.sourceUid === card.uid)) mask |= 0x10000;
  return mask;
}

function isRelatedToBattle(state: DuelState, uid: string): boolean {
  const battle = state.currentAttack ?? state.pendingBattle;
  return battle?.attackerUid === uid || battle?.targetUid === uid;
}

function isOpposingMonsterBattle(state: DuelState, uid: string): boolean {
  const battle = state.currentAttack ?? state.pendingBattle;
  return Boolean(battle?.targetUid && (battle.attackerUid === uid || battle.targetUid === uid));
}

function canTurnSet(card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || !card.faceUp) return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  return (cardTypeFlags(card) & 0x4000000) === 0;
}

function hasAdjacentMonsterZone(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || card.sequence > 4) return false;
  return [card.sequence - 1, card.sequence + 1].some(
    (sequence) =>
      sequence >= 0 &&
      sequence <= 4 &&
      !state.cards.some((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && candidate.sequence === sequence),
  );
}

function pushCanChainAttack(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const requestedAllowance = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1;
  const attackCount = card ? session.state.attacksDeclared.filter((uid) => uid === card.uid).length : 0;
  lua.lua_pushboolean(L, Boolean(card && attackCount > 0 && canDuelCardAttack(session.state, card.uid, requestedAllowance)));
  return 1;
}

function canChangePosition(state: DuelState, card: DuelCardInstance, requested: CardPosition | undefined): boolean {
  if (requested) return canChangeDuelCardPosition(state, card.uid, requested);
  if (card.position === "faceUpAttack") return canChangeDuelCardPosition(state, card.uid, "faceUpDefense");
  if (card.position === "faceUpDefense" || card.position === "faceDownDefense") return canChangeDuelCardPosition(state, card.uid, "faceUpAttack");
  return false;
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
