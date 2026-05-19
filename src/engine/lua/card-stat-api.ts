import fengari from "fengari";
import { collectDuelTriggerEffects } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { cardLink, cardMainTypeFlags, cardRank, cardTypeFlags, currentAttack, currentAttribute, currentBaseAttack, currentBaseDefense, currentDefense, currentLeftScale, currentLevel, currentLink, currentLinkMarkers, currentRace, currentRank, currentRightScale, printedCardTypeFlags } from "#duel/card-stats.js";
import { readCardUid } from "#lua/api-utils.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import type { DuelCardInstance, DuelSession, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

type LuaCardStatHostState<EffectRecord extends LuaCardApiEffectRecord> = LuaCardApiState<EffectRecord> & LuaMoveImmunityHostState<EffectRecord> & LuaOperationTimingBoundaryHostState;

export { cardLink, cardMainTypeFlags, cardRank, cardTypeFlags, currentAttack, currentAttribute, currentDefense, currentLeftScale, currentLevel, currentLinkMarkers, currentRace, currentRank, currentRightScale, printedCardTypeFlags } from "#duel/card-stats.js";

export function installCardStatApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushAssumeProperty(state, session));
  lua.lua_setfield(L, -2, to_luastring("AssumeProperty"));
  pushNumberGetter(L, "GetType", session, (card) => cardTypeFlags(card, session.state));
  pushNumberGetter(L, "GetOriginalType", session, (card) => printedCardTypeFlags(card));
  pushNumberGetter(L, "GetMainCardType", session, (card) => cardMainTypeFlags(card, session.state));
  pushAnyNumberMatcher(L, "IsType", session, (card, requested) => requested.some((value) => (cardTypeFlags(card, session.state) & value) !== 0));
  pushNumberMatcher(L, "IsExactType", session, (card, requested) => cardTypeFlags(card, session.state) === requested);
  pushBooleanGetter(L, "IsPlusOrMinus", session, (card) => {
    const plusMinusType = cardTypeFlags(card, session.state) & 0x60000000;
    return plusMinusType !== 0 && plusMinusType !== 0x60000000;
  });
  pushAnyNumberMatcher(L, "IsNotType", session, (card, requested) => requested.every((value) => (cardTypeFlags(card, session.state) & value) === 0));
  pushAnyNumberMatcher(L, "IsOriginalType", session, (card, requested) => requested.some((value) => (printedCardTypeFlags(card) & value) !== 0));
  pushAnyNumberMatcher(L, "IsNotOriginalType", session, (card, requested) => requested.every((value) => (printedCardTypeFlags(card) & value) === 0));
  pushNumberGetter(L, "GetAttack", session, (card) => currentAttack(card, session.state));
  pushNumberGetter(L, "GetBaseAttack", session, (card) => currentBaseAttack(card, session.state));
  pushNumberGetter(L, "GetTextAttack", session, (card) => currentAttack(card, session.state));
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateAttack(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateAttack"));
  pushBooleanGetter(L, "HasNonZeroAttack", session, (card) => Boolean(card && currentAttack(card, session.state) !== 0));
  pushAnyNumberMatcher(L, "IsAttack", session, (card, requested) => requested.includes(currentAttack(card, session.state)));
  pushAnyNumberMatcher(L, "IsBaseAttack", session, (card, requested) => requested.includes(currentBaseAttack(card, session.state)));
  pushAnyNumberMatcher(L, "IsOriginalAttack", session, (card, requested) => requested.includes(card.data.attack ?? 0));
  pushAnyNumberMatcher(L, "IsTextAttack", session, (card, requested) => requested.includes(currentAttack(card, session.state)));
  pushNumberMatcher(L, "IsAttackAbove", session, (card, requested) => currentAttack(card, session.state) >= requested);
  pushNumberMatcher(L, "IsAttackBelow", session, (card, requested) => currentAttack(card, session.state) <= requested);
  pushNumberMatcher(L, "IsOriginalAttackAbove", session, (card, requested) => (card.data.attack ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalAttackBelow", session, (card, requested) => (card.data.attack ?? 0) <= requested);
  pushNumberGetter(L, "GetDefense", session, (card) => currentDefense(card, session.state));
  pushNumberGetter(L, "GetBaseDefense", session, (card) => currentBaseDefense(card, session.state));
  pushNumberGetter(L, "GetTextDefense", session, (card) => currentDefense(card, session.state));
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateDefense(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateDefense"));
  pushBooleanGetter(L, "HasDefense", session, (card) => hasDefense(card, session.state));
  pushBooleanGetter(L, "HasNonZeroDefense", session, (card) => Boolean(card && currentDefense(card, session.state) !== 0));
  pushAnyNumberMatcher(L, "IsDefense", session, (card, requested) => hasDefense(card, session.state) && requested.includes(currentDefense(card, session.state)));
  pushAnyNumberMatcher(L, "IsBaseDefense", session, (card, requested) => hasDefense(card, session.state) && requested.includes(currentBaseDefense(card, session.state)));
  pushAnyNumberMatcher(L, "IsOriginalDefense", session, (card, requested) => hasDefense(card, session.state) && requested.includes(card.data.defense ?? 0));
  pushAnyNumberMatcher(L, "IsTextDefense", session, (card, requested) => hasDefense(card, session.state) && requested.includes(currentDefense(card, session.state)));
  pushNumberMatcher(L, "IsDefenseAbove", session, (card, requested) => hasDefense(card, session.state) && currentDefense(card, session.state) >= requested);
  pushNumberMatcher(L, "IsDefenseBelow", session, (card, requested) => hasDefense(card, session.state) && currentDefense(card, session.state) <= requested);
  pushNumberMatcher(L, "IsOriginalDefenseAbove", session, (card, requested) => hasDefense(card, session.state) && (card.data.defense ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalDefenseBelow", session, (card, requested) => hasDefense(card, session.state) && (card.data.defense ?? 0) <= requested);
  pushNumberGetter(L, "GetLevel", session, (card) => hasLevel(card, session.state) ? currentLevel(card, session.state) : 0);
  pushNumberGetter(L, "Level", session, (card) => hasLevel(card, session.state) ? currentLevel(card, session.state) : 0);
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateLevel(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateLevel"));
  pushNumberGetter(L, "GetOriginalLevel", session, (card) => hasLevel(card, session.state) ? card?.data.level ?? 0 : 0);
  pushNumberGetter(L, "GetLeftScale", session, (card) => currentLeftScale(card, session.state));
  pushNumberGetter(L, "GetRightScale", session, (card) => currentRightScale(card, session.state));
  pushNumberGetter(L, "GetOriginalLeftScale", session, (card) => card?.data.leftScale ?? 0);
  pushNumberGetter(L, "GetOriginalRightScale", session, (card) => card?.data.rightScale ?? 0);
  pushNumberGetter(L, "GetScale", session, (card) => cardScale(card, session.state));
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateScale(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateScale"));
  pushNumberMatcher(L, "IsScale", session, (card, requested) => cardScale(card, session.state) === requested);
  pushBooleanGetter(L, "IsOddScale", session, (card) => isPendulumCardData(card, session.state) && cardScale(card, session.state) % 2 !== 0);
  pushBooleanGetter(L, "IsEvenScale", session, (card) => isPendulumCardData(card, session.state) && cardScale(card, session.state) % 2 === 0);
  pushBooleanGetter(L, "HasLevel", session, (card) => hasLevel(card, session.state));
  pushAnyNumberMatcher(L, "IsLevel", session, (card, requested) => hasLevel(card, session.state) && requested.includes(currentLevel(card, session.state)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const firstLevel = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    const secondLevel = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    const lower = firstLevel === undefined || secondLevel === undefined ? undefined : Math.min(firstLevel, secondLevel);
    const upper = firstLevel === undefined || secondLevel === undefined ? undefined : Math.max(firstLevel, secondLevel);
    const level = currentLevel(card, session.state);
    lua.lua_pushboolean(state, Boolean(card && hasLevel(card, session.state) && lower !== undefined && upper !== undefined && level >= lower && level <= upper));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLevelBetween"));
  pushNumberMatcher(L, "IsLevelAbove", session, (card, requested) => hasLevel(card, session.state) && currentLevel(card, session.state) >= requested);
  pushNumberMatcher(L, "IsLevelBelow", session, (card, requested) => hasLevel(card, session.state) && currentLevel(card, session.state) <= requested);
  pushAnyNumberMatcher(L, "IsOriginalLevel", session, (card, requested) => hasLevel(card, session.state) && requested.includes(card.data.level ?? 0));
  pushNumberMatcher(L, "IsOriginalLevelAbove", session, (card, requested) => hasLevel(card, session.state) && (card.data.level ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalLevelBelow", session, (card, requested) => hasLevel(card, session.state) && (card.data.level ?? 0) <= requested);
  pushNumberGetter(L, "GetRank", session, (card) => currentRank(card, session.state));
  pushNumberGetter(L, "GetOriginalRank", session, (card) => cardRank(card));
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateRank(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateRank"));
  pushBooleanGetter(L, "HasRank", session, (card) => hasRank(card, session.state));
  pushAnyNumberMatcher(L, "IsRank", session, (card, requested) => hasRank(card, session.state) && requested.includes(currentRank(card, session.state)));
  pushNumberMatcher(L, "IsRankAbove", session, (card, requested) => hasRank(card, session.state) && currentRank(card, session.state) >= requested);
  pushNumberMatcher(L, "IsRankBelow", session, (card, requested) => hasRank(card, session.state) && currentRank(card, session.state) <= requested);
  pushAnyNumberMatcher(L, "IsOriginalRank", session, (card, requested) => hasRank(card, session.state) && requested.includes(cardRank(card)));
  pushNumberMatcher(L, "IsOriginalRankAbove", session, (card, requested) => hasRank(card, session.state) && cardRank(card) >= requested);
  pushNumberMatcher(L, "IsOriginalRankBelow", session, (card, requested) => hasRank(card, session.state) && cardRank(card) <= requested);
  pushNumberGetter(L, "GetLink", session, (card) => currentLink(card, session.state));
  pushNumberGetter(L, "GetOriginalLink", session, (card) => cardLink(card));
  lua.lua_pushcfunction(L, (state: unknown) => pushUpdateLink(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("UpdateLink"));
  pushAnyNumberMatcher(L, "IsLink", session, (card, requested) => requested.includes(currentLink(card, session.state)));
  pushNumberMatcher(L, "IsLinkAbove", session, (card, requested) => currentLink(card, session.state) >= requested);
  pushNumberMatcher(L, "IsLinkBelow", session, (card, requested) => currentLink(card, session.state) <= requested);
  pushAnyNumberMatcher(L, "IsOriginalLink", session, (card, requested) => requested.includes(cardLink(card)));
  pushNumberMatcher(L, "IsOriginalLinkAbove", session, (card, requested) => cardLink(card) >= requested);
  pushNumberMatcher(L, "IsOriginalLinkBelow", session, (card, requested) => cardLink(card) <= requested);
  pushBooleanGetter(L, "IsLinkMonster", session, (card) => currentLink(card, session.state) > 0);
  pushNumberGetter(L, "GetLinkMarker", session, (card) => currentLinkMarkers(card, session.state));
  pushNumberGetter(L, "GetRace", session, (card) => currentRace(card, session.state));
  pushNumberGetter(L, "GetOriginalRace", session, (card) => card?.data.race ?? 0);
  pushAnyNumberMatcher(L, "IsRace", session, (card, requested) => requested.some((value) => (currentRace(card, session.state) & value) !== 0));
  pushAnyNumberMatcher(L, "IsRaceExcept", session, (card, requested) => requested.some((value) => (currentRace(card, session.state) & value) !== currentRace(card, session.state)));
  pushAnyNumberMatcher(L, "IsNotRace", session, (card, requested) => requested.every((value) => (currentRace(card, session.state) & value) === 0));
  pushAnyNumberMatcher(L, "IsOriginalRace", session, (card, requested) => requested.some((value) => ((card.data.race ?? 0) & value) !== 0));
  pushAnyNumberMatcher(L, "IsNotOriginalRace", session, (card, requested) => requested.every((value) => ((card.data.race ?? 0) & value) === 0));
  pushNumberGetter(L, "AnnounceAnotherRace", session, (card) => firstDifferentBit(card?.data.race ?? 0, 0x3ffffff, 0x2000000));
  pushNumberGetter(L, "GetAttribute", session, (card) => currentAttribute(card, session.state));
  pushNumberGetter(L, "GetOriginalAttribute", session, (card) => card?.data.attribute ?? 0);
  pushAnyNumberMatcher(L, "IsAttribute", session, (card, requested) => requested.some((value) => (currentAttribute(card, session.state) & value) !== 0));
  pushAnyNumberMatcher(L, "IsAttributeExcept", session, (card, requested) => requested.some((value) => (currentAttribute(card, session.state) & ~value) !== 0));
  pushAnyNumberMatcher(L, "IsDifferentAttribute", session, (card, requested) => requested.some((value) => (currentAttribute(card, session.state) & ~value) !== 0));
  pushAnyNumberMatcher(L, "IsNotAttribute", session, (card, requested) => requested.every((value) => (currentAttribute(card, session.state) & value) === 0));
  pushAnyNumberMatcher(L, "IsOriginalAttribute", session, (card, requested) => requested.some((value) => ((card.data.attribute ?? 0) & value) !== 0));
  pushAnyNumberMatcher(L, "IsNotOriginalAttribute", session, (card, requested) => requested.every((value) => ((card.data.attribute ?? 0) & value) === 0));
  pushNumberGetter(L, "AnnounceAnotherAttribute", session, (card) => firstDifferentBit(card?.data.attribute ?? 0, 0x7f, 0x40));
  pushBooleanGetter(L, "IsQuickPlaySpell", session, (card) => (cardTypeFlags(card, session.state) & 0x10002) === 0x10002);
  pushBooleanGetter(L, "IsTrapCard", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x4) !== 0));
  pushBooleanGetter(L, "IsTrapMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x4) !== 0 && ((card.data.level ?? 0) > 0 || (card.data.attribute ?? 0) > 0 || (card.data.race ?? 0) > 0)));
}

export function cardScale(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!isPendulumCardData(card, state)) return 0;
  if (card.location !== "spellTrapZone") return currentLeftScale(card, state);
  return card.sequence === 0 || card.sequence === 1 || card.sequence === 6 ? currentLeftScale(card, state) : currentRightScale(card, state);
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

function hasDefense(card: DuelCardInstance | undefined, state?: DuelState): boolean {
  return Boolean(card && (cardTypeFlags(card, state) & 0x1) !== 0 && (cardTypeFlags(card, state) & 0x4000000) === 0);
}

function hasLevel(card: DuelCardInstance | undefined, state?: DuelState): boolean {
  return Boolean(card && (cardTypeFlags(card, state) & 0x1) !== 0 && cardRank(card) === 0 && cardLink(card) === 0);
}

function hasRank(card: DuelCardInstance | undefined, state?: DuelState): boolean {
  return Boolean(card && (cardTypeFlags(card, state) & 0x800000) !== 0);
}

function firstDifferentBit(currentMask: number, allMask: number, maxBit: number): number {
  const allowedMask = currentMask > 0 && isSingleBit(currentMask) ? allMask & ~currentMask : allMask;
  for (let bit = 1; bit <= maxBit; bit <<= 1) {
    if ((allowedMask & bit) !== 0) return bit;
  }
  for (let bit = 1; bit <= maxBit; bit <<= 1) {
    if ((allMask & bit) !== 0) return bit;
  }
  return 0;
}

function isSingleBit(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function pushAssumeProperty(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session);
  const property = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const value = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : undefined;
  if (card && property !== undefined && value !== undefined) {
    card.assumedProperties = card.assumedProperties ?? {};
    card.assumedProperties[property] = value;
  }
  return 0;
}

function pushUpdateAttack<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  const amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentAttack(card, session.state);
  card.attackModifier = (card.attackModifier ?? 0) + amount;
  lua.lua_pushinteger(L, currentAttack(card, session.state) - before);
  return 1;
}

function pushUpdateDefense<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  const amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentDefense(card, session.state);
  card.defenseModifier = (card.defenseModifier ?? 0) + amount;
  lua.lua_pushinteger(L, currentDefense(card, session.state) - before);
  return 1;
}

function pushUpdateLevel<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  let amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentLevel(card, session.state);
  if (before + amount <= 0) amount = -(before - 1);
  card.levelModifier = (card.levelModifier ?? 0) + amount;
  const delta = currentLevel(card, session.state) - before;
  if (delta !== 0) {
    markLuaOperationTimingBoundary(session, hostState);
    collectStatEvent(session, hostState, "levelChanged", card);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushinteger(L, delta);
  return 1;
}

function collectStatEvent(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, eventName: "levelChanged", card: DuelCardInstance): void {
  collectDuelTriggerEffects(session.state, eventName, card, luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer));
}

function pushUpdateRank<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  let amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentRank(card, session.state);
  if (before + amount <= 0) amount = -(before - 1);
  card.rankModifier = (card.rankModifier ?? 0) + amount;
  lua.lua_pushinteger(L, currentRank(card, session.state) - before);
  return 1;
}

function pushUpdateLink<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  let amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentLink(card, session.state);
  if (before + amount <= 0) amount = -(before - 1);
  card.linkModifier = (card.linkModifier ?? 0) + amount;
  lua.lua_pushinteger(L, currentLink(card, session.state) - before);
  return 1;
}

function pushUpdateScale<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardStatHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  let amount = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!isPendulumCardData(card, session.state) || currentLeftScale(card, session.state) === 0 || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = currentLeftScale(card, session.state);
  if (before + amount <= 0) amount = -(before - 1);
  card.scaleModifier = (card.scaleModifier ?? 0) + amount;
  lua.lua_pushinteger(L, currentLeftScale(card, session.state) - before);
  return 1;
}

function isPendulumCardData(card: DuelCardInstance | undefined, state?: DuelState): card is DuelCardInstance {
  return Boolean(card && (cardTypeFlags(card, state) & 0x1000000) !== 0);
}
