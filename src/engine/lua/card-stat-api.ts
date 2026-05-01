import fengari from "fengari";
import { readCardUid } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardStatApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetType", session, (card) => cardTypeFlags(card));
  pushNumberGetter(L, "GetOriginalType", session, (card) => cardTypeFlags(card));
  pushNumberGetter(L, "GetMainCardType", session, (card) => cardMainTypeFlags(card));
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
  pushBooleanGetter(L, "HasNonZeroDefense", session, (card) => Boolean(card && (card.data.defense ?? 0) !== 0));
  pushNumberMatcher(L, "IsDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberMatcher(L, "IsOriginalDefense", session, (card, requested) => (card.data.defense ?? 0) === requested);
  pushNumberMatcher(L, "IsDefenseAbove", session, (card, requested) => (card.data.defense ?? 0) >= requested);
  pushNumberMatcher(L, "IsDefenseBelow", session, (card, requested) => (card.data.defense ?? 0) <= requested);
  pushNumberMatcher(L, "IsOriginalDefenseAbove", session, (card, requested) => (card.data.defense ?? 0) >= requested);
  pushNumberMatcher(L, "IsOriginalDefenseBelow", session, (card, requested) => (card.data.defense ?? 0) <= requested);
  pushNumberGetter(L, "GetLevel", session, (card) => card?.data.level ?? 0);
  pushNumberGetter(L, "GetOriginalLevel", session, (card) => card?.data.level ?? 0);
  pushNumberGetter(L, "GetLeftScale", session, (card) => card?.data.leftScale ?? 0);
  pushNumberGetter(L, "GetRightScale", session, (card) => card?.data.rightScale ?? 0);
  pushNumberGetter(L, "GetOriginalLeftScale", session, (card) => card?.data.leftScale ?? 0);
  pushNumberGetter(L, "GetOriginalRightScale", session, (card) => card?.data.rightScale ?? 0);
  pushNumberGetter(L, "GetScale", session, (card) => cardScale(card));
  pushNumberMatcher(L, "IsScale", session, (card, requested) => cardScale(card) === requested);
  pushBooleanGetter(L, "IsOddScale", session, (card) => isPendulumCardData(card) && cardScale(card) % 2 !== 0);
  pushBooleanGetter(L, "IsEvenScale", session, (card) => isPendulumCardData(card) && cardScale(card) % 2 === 0);
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
  pushBooleanGetter(L, "IsLinkMonster", session, (card) => cardLink(card) > 0);
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
  pushNumberMatcher(L, "IsAttributeExcept", session, (card, requested) => ((card.data.attribute ?? 0) & ~requested) !== 0);
  pushNumberMatcher(L, "IsNotAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) === 0);
  pushNumberMatcher(L, "IsOriginalAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) !== 0);
  pushNumberMatcher(L, "IsNotOriginalAttribute", session, (card, requested) => ((card.data.attribute ?? 0) & requested) === 0);
}

export function cardTypeFlags(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
}

export function cardMainTypeFlags(card: DuelCardInstance | undefined): number {
  return cardTypeFlags(card) & 0x7;
}

export function cardRank(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
}

export function cardLink(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x4000000) !== 0 ? card.data.level ?? 0 : 0;
}

export function cardScale(card: DuelCardInstance | undefined): number {
  if (!isPendulumCardData(card)) return 0;
  if (card.location !== "spellTrapZone") return card.data.leftScale ?? 0;
  return card.sequence === 0 || card.sequence === 1 || card.sequence === 6 ? card.data.leftScale ?? 0 : card.data.rightScale ?? 0;
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

function isPendulumCardData(card: DuelCardInstance | undefined): card is DuelCardInstance {
  return Boolean(card && (cardTypeFlags(card) & 0x1000000) !== 0);
}
