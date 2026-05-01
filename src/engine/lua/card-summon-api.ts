import fengari from "fengari";
import { readTableStringField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelPhase, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardSummonApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetSummonType", session, (card) => summonTypeMask(card));
  pushNumberGetter(L, "GetSummonPhase", session, (card) => phaseMask(card?.summonPhase));
  pushNumberGetter(L, "GetMaterialCount", session, (card) => materialCount(card));
  pushNumberGetter(L, "GetMaterialCountRush", session, (card) => materialCountRush(card));
  pushBooleanGetter(L, "IsNormalSummoned", session, (card) => isSummonTypeMatch(summonTypeMask(card), 0x10000000));
  pushBooleanGetter(L, "IsTributeSummoned", session, (card) => Boolean(card && card.summonType === "tribute"));
  pushBooleanGetter(L, "IsFlipSummoned", session, (card) => Boolean(card && card.summonType === "flip"));
  pushBooleanGetter(L, "IsSpecialSummoned", session, (card) => Boolean(card && card.summonType !== undefined && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip"));
  pushNumberMatcher(L, "IsSummonType", session, (card, requested) => isSummonTypeMatch(summonTypeMask(card), requested));
  pushSummonTypePredicate(L, "IsGeminiSummoned", session, 0x12000000);
  pushSummonTypePredicate(L, "IsRitualSummoned", session, 0x45000000);
  pushSummonTypePredicate(L, "IsFusionSummoned", session, 0x43000000);
  pushSummonTypePredicate(L, "IsSynchroSummoned", session, 0x46000000);
  pushSummonTypePredicate(L, "IsXyzSummoned", session, 0x49000000);
  pushSummonTypePredicate(L, "IsPendulumSummoned", session, 0x4a000000);
  pushSummonTypePredicate(L, "IsLinkSummoned", session, 0x4c000000);
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
  if (card.summonType === "link") return 0x4c000000;
  return 0;
}

function materialCount(card: DuelCardInstance | undefined): number {
  return card?.summonMaterialUids?.length ?? card?.overlayUids.length ?? 0;
}

function materialCountRush(card: DuelCardInstance | undefined): number {
  const count = materialCount(card);
  return summonTypeMask(card) === 0x11000000 + 100 ? count + 1 : count;
}

function phaseMask(phase: DuelPhase | undefined): number {
  if (phase === "draw") return 0x1;
  if (phase === "standby") return 0x2;
  if (phase === "main1") return 0x4;
  if (phase === "battle") return 0x80;
  if (phase === "main2") return 0x100;
  if (phase === "end") return 0x200;
  return 0;
}

function isSummonTypeMatch(actual: number, requested: number): boolean {
  if (actual === 0 || requested === 0) return false;
  return actual === requested || (actual & requested) === requested;
}
