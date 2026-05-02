import fengari from "fengari";
import { hasZoneSpace } from "#duel/card-state.js";
import { canDuelCardAttack, canMoveDuelCardToLocation, moveDuelCard, registerEffect } from "#duel/core.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { installCardBattleApi } from "#lua/card-battle-api.js";
import { installCardCodeApi } from "#lua/card-code-api.js";
import { installCardColumnApi } from "#lua/card-column-api.js";
import { cardCodes, readRequestedNumbers } from "#lua/card-code-utils.js";
import { installCardCounterApi } from "#lua/card-counter-api.js";
import { canMoveCardToDeckOrExtraAsCost, isMonsterLike } from "#lua/card-eligibility-api.js";
import { createLuaMaterialCheckContext, installCardEffectQueryApi, isNegatableCard, matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { installCardEquipApi } from "#lua/card-equip-api.js";
import { installCardFlagApi } from "#lua/card-flag-api.js";
import { installCardLinkApi } from "#lua/card-link-api.js";
import { installCardLinkedApi } from "#lua/card-linked-api.js";
import { installCardMaterialApi } from "#lua/card-material-api.js";
import { installCardOverlayApi } from "#lua/card-overlay-api.js";
import { installCardPreviousStateApi } from "#lua/card-previous-state-api.js";
import { installCardReasonApi } from "#lua/card-reason-api.js";
import { installCardRelationApi } from "#lua/card-relation-api.js";
import { installCardRushApi } from "#lua/card-rush-api.js";
import { cardTypeFlags, installCardStatApi } from "#lua/card-stat-api.js";
import { installCardStatusApi } from "#lua/card-status-api.js";
import { installCardSummonApi } from "#lua/card-summon-api.js";
import { installCardSummonPredicateApi } from "#lua/card-summon-predicate-api.js";
import { installCardTableApi, pushCardTable } from "#lua/card-table-api.js";
import { installCardTypePredicateApi } from "#lua/card-type-predicate-api.js";
import {
  locationsFromMask,
  readCardUid,
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
  installCardStatusApi(L, session, hostState);
  installStateHelpers(L, session, hostState);
  installCardFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Card"));
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
  installCardOverlayApi(L, session, hostState);
  installCardEquipApi(L, session, hostState);
  installCardCounterApi(L, session);
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
  installCardTypePredicateApi(L, session);
  installCardLinkedApi(L, session);
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
  installCardMaterialApi(L, session);
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

function canChangeControl(state: DuelState, card: DuelCardInstance, targetPlayer: PlayerId): boolean {
  if (card.controller === targetPlayer) return false;
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  return hasZoneSpace(state, targetPlayer, card.location);
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

function readCard(L: unknown, session: DuelSession | undefined): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid && session ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
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

function isRelatedToBattle(state: DuelState, uid: string): boolean {
  const battle = state.currentAttack ?? state.pendingBattle;
  return battle?.attackerUid === uid || battle?.targetUid === uid;
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
