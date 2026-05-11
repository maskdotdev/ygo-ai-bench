import fengari from "fengari";
import { canSpecialSummonDuelCard } from "#duel/core.js";
import { isMonsterSetPrevented, isNormalSummonPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { hasNormalSummonCountAvailable } from "#duel/extra-normal-summon.js";
import { normalSummonActions, tributeSummonActions } from "#duel/summon.js";
import { luaSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { positionFromMask, readTableStringField } from "#lua/api-utils.js";
import { canSpecialSummonFromLua } from "#lua/card-eligibility-api.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { isNoTributePlayerAffected } from "#lua/no-tribute-api.js";
import { readMinTributeRequirement, withLuaMinTributeOverride } from "#lua/tribute-metadata-api.js";
import type { DuelAction, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardSummonPredicateApi(L: unknown, session: DuelSession): void {
  pushSummonPredicate(L, "IsSummonable", session, "normalSummon");
  pushSummonPredicate(L, "IsSummonableCard", session, "normalSummon");
  pushSummonPredicate(L, "CanSummonOrSet", session, "summonOrSet");
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && canSpecialSummonDuelCard(session.state, card.uid, card.controller)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSpecialSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanBeSpecialSummoned(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanBeSpecialSummoned"));
  pushSummonPredicate(L, "IsMSetable", session, "setMonster");
}

function pushCanBeSpecialSummoned(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const summonType = luaSpecialSummonTypeCode(lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0);
  const player = readSpecialSummonTargetPlayer(L, card);
  const ignoreSummonCondition = lua.lua_toboolean(L, 5);
  const positionMask = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : 0x1;
  const position = positionFromMask(positionMask);
  const zoneMask = lua.lua_isnumber(L, 9) ? lua.lua_tointeger(L, 9) : undefined;
  lua.lua_pushboolean(L, Boolean(position && card && player !== undefined && canSpecialSummonFromLua(session, card, player, summonType, zoneMask, ignoreSummonCondition, position)));
  return 1;
}

function pushSummonPredicate(L: unknown, fieldName: string, session: DuelSession, kind: "normalSummon" | "setMonster" | "summonOrSet"): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const ignoreCount = lua.lua_toboolean(state, 2);
    const minTributes = lua.lua_isnumber(state, 4) ? Math.max(0, lua.lua_tointeger(state, 4)) : readMinTributeRequirement(state, card);
    const actions = card ? summonActionsForCard(session, card, ignoreCount, minTributes) : [];
    lua.lua_pushboolean(
      state,
      kind === "summonOrSet"
        ? actions.some((action) => actionHasUid(action, card?.uid))
        : actions.some((action) => actionMatchesKind(action, kind) && actionHasUid(action, card?.uid)),
    );
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function summonActionsForCard(session: DuelSession, card: DuelCardInstance, ignoreCount: boolean, minTributes: number | undefined): DuelAction[] {
  const readActions = (): DuelAction[] => [
    ...(canUseNoTributeSummon(session, card) ? [{ type: "normalSummon" as const, player: card.controller, uid: card.uid, label: `Normal Summon ${card.name}` }] : normalSummonActions(session.state, card.controller, [card])),
    ...tributeSummonActions(session.state, card.controller, [card]),
  ].filter((action) => summonPredicateActionAllowed(session, card, action));
  const readWithTributeOverride = (): DuelAction[] => withLuaMinTributeOverride(card, minTributes, readActions);
  if (!ignoreCount) return readWithTributeOverride();
  const previous = session.state.players[card.controller].normalSummonAvailable;
  session.state.players[card.controller].normalSummonAvailable = true;
  try {
    return readWithTributeOverride();
  } finally {
    session.state.players[card.controller].normalSummonAvailable = previous;
  }
}

function canUseNoTributeSummon(session: DuelSession, card: DuelCardInstance): boolean {
  return hasNormalSummonCountAvailable(session.state, card.controller, card) && availableMonsterZoneCount(session, card.controller, []) > 0 && isNoTributePlayerAffected(session, card.controller) && !isNormalSummonPrevented(session.state, card.controller, card, createPredicateContext(session));
}

function summonPredicateActionAllowed(session: DuelSession, card: DuelCardInstance, action: DuelAction): boolean {
  if (!actionHasUid(action, card.uid)) return true;
  if (action.type === "normalSummon" || action.type === "tributeSummon") return !isNormalSummonPrevented(session.state, card.controller, card, createPredicateContext(session));
  if (action.type === "setMonster") return !isMonsterSetPrevented(session.state, card.controller, card, createPredicateContext(session));
  return true;
}

function createPredicateContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source, card) => ({
    duel: session.state,
    source,
    player: effect.controller,
    ...(card === undefined ? {} : { eventCard: card }),
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      const moved = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!moved) throw new Error(`Card ${uid} not found`);
      moved.location = to;
      if (controller !== undefined) moved.controller = controller;
      return moved;
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function actionMatchesKind(action: DuelAction, kind: "normalSummon" | "setMonster"): boolean {
  if (kind === "normalSummon") return action.type === "normalSummon" || action.type === "tributeSummon";
  if (kind === "setMonster") return action.type === "setMonster" || action.type === "tributeSummon";
  return action.type === kind;
}

function actionHasUid(action: DuelAction, uid: string | undefined): boolean {
  return uid !== undefined && "uid" in action && action.uid === uid;
}

function readSpecialSummonTargetPlayer(L: unknown, card: DuelCardInstance | undefined): PlayerId | undefined {
  if (lua.lua_isnumber(L, 8)) return normalizePlayer(lua.lua_tointeger(L, 8));
  if (lua.lua_isnumber(L, 4)) return normalizePlayer(lua.lua_tointeger(L, 4));
  return card?.controller;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  if (!uid) return undefined;
  return session.state.cards.find((card) => card.uid === uid);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
