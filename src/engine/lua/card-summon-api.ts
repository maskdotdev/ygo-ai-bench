import fengari from "fengari";
import { getDuelFlagEffectLabel } from "#duel/flags.js";
import { phaseMask } from "#duel/phase-mask.js";
import { locationMatchesCardMask, readTableStringField } from "#lua/api-utils.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const cardSalamangreatSanctuary = 1295111;

export function installCardSummonApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetSummonType", session, (card) => summonTypeMask(card));
  pushNumberGetter(L, "GetSummonPhase", session, (card) => phaseMask(card?.summonPhase));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.summonType && requested.some((value) => locationMatchesCardMask(card, value, card.summonLocation ?? card.previousLocation, card.previousSequence))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedPlayers(state, 2);
    lua.lua_pushboolean(state, Boolean(card?.summonPlayer !== undefined && requested.includes(card.summonPlayer)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const phase = phaseMask(card?.summonPhase);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => phase === value || (phase & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonPhase"));
  pushBooleanGetter(L, "IsSummonPhaseMain", session, (card) => {
    const phase = phaseMask(card?.summonPhase);
    return phase === 0x4 || phase === 0x100;
  });
  pushBooleanGetter(L, "IsSummonPhaseBattle", session, (card) => {
    const phase = phaseMask(card?.summonPhase);
    return phase >= 0x8 && phase <= 0x80;
  });
  pushNumberGetter(L, "GetMaterialCount", session, (card) => materialCount(card));
  pushNumberGetter(L, "GetMaterialCountRush", session, (card) => materialCountRush(card));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, materialUids(card));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMaterial"));
  pushBooleanGetter(L, "IsNormalSummoned", session, (card) => isSummonTypeMatch(summonTypeMask(card), 0x10000000));
  pushBooleanGetter(L, "IsTributeSummoned", session, (card) => Boolean(card && card.summonType === "tribute"));
  pushBooleanGetter(L, "IsFlipSummoned", session, (card) => Boolean(card && card.summonType === "flip"));
  pushBooleanGetter(L, "IsSpecialSummoned", session, (card) => Boolean(card && card.summonType !== undefined && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => isSummonTypeMatch(summonTypeMask(card), value))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonType"));
  pushSummonTypePredicate(L, "IsGeminiSummoned", session, 0x12000000);
  pushSummonTypePredicate(L, "IsRitualSummoned", session, 0x45000000);
  pushSummonTypePredicate(L, "IsFusionSummoned", session, 0x43000000);
  pushSummonTypePredicate(L, "IsSynchroSummoned", session, 0x46000000);
  pushSummonTypePredicate(L, "IsXyzSummoned", session, 0x49000000);
  pushSummonTypePredicate(L, "IsPendulumSummoned", session, 0x4a000000);
  pushSummonTypePredicate(L, "IsLinkSummoned", session, 0x4c000000);
  pushBooleanGetter(L, "IsReincarnationSummoned", session, (card) => isReincarnationSummoned(session, card));
}

function pushSummonTypePredicate(L: unknown, fieldName: string, session: DuelSession, summonMask: number): void {
  pushBooleanGetter(L, fieldName, session, (card) => isSummonTypeMatch(summonTypeMask(card), summonMask));
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
  const uid = readTableStringField(L, 1, "__duel_uid");
  if (!uid) return undefined;
  return session.state.cards.find((card) => card.uid === uid);
}

function summonTypeMask(card: DuelCardInstance | undefined): number {
  if (card?.summonTypeCode !== undefined) return card.summonTypeCode;
  if (!card?.summonType) return 0;
  if (card.summonType === "normal") return 0x10000000;
  if (card.summonType === "tribute") return 0x11000000;
  if (card.summonType === "flip") return 0x20000000;
  if (card.summonType === "special") return 0x40000000;
  if (card.summonType === "fusion") return 0x43000000;
  if (card.summonType === "ritual") return 0x45000000;
  if (card.summonType === "synchro") return 0x46000000;
  if (card.summonType === "xyz") return 0x49000000;
  if (card.summonType === "pendulum") return 0x4a000000;
  if (card.summonType === "link") return 0x4c000000;
  return 0;
}

function materialCount(card: DuelCardInstance | undefined): number {
  return materialUids(card).length;
}

function materialUids(card: DuelCardInstance | undefined): string[] {
  return [...(card?.summonMaterialUids ?? card?.overlayUids ?? [])];
}

function materialCountRush(card: DuelCardInstance | undefined): number {
  const count = materialCount(card);
  return summonTypeMask(card) === 0x11000000 + 100 ? count + 1 : count;
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

function readRequestedPlayers(L: unknown, startIndex: number): PlayerId[] {
  return readRequestedNumbers(L, startIndex).map(normalizePlayer);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function isReincarnationSummoned(session: DuelSession, card: DuelCardInstance | undefined): boolean {
  if (!card) return false;
  const label = getDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: card.uid }, cardSalamangreatSanctuary);
  return (label & ((card.summonPlayer ?? card.controller) + 1)) !== 0;
}

function isSummonTypeMatch(actual: number, requested: number): boolean {
  if (actual === 0 || requested === 0) return false;
  return actual === requested || (actual & requested) === requested;
}
