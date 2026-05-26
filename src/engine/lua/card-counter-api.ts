import fengari from "fengari";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled, isCounterPlacementPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { addDuelCardCounter, canAddDuelCardCounter, getAllDuelCardCounters, getDuelCardCounter, removeAllDuelCardCounters, removeDuelCardCounter, type DuelCounterBucket } from "#duel/counters.js";
import { collectDuelTriggerEffects } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { locationMatchesCardMask, readTableStringField } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-table-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import type { DuelCardInstance, DuelEventName, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;
const counterWithoutPermit = 0x1000;
const counterNeedEnable = 0x2000;
const effectCounterPermit = 0x10000;
const effectCounterLimit = 0x20000;

type LuaCardCounterHostState<EffectRecord extends LuaCardApiEffectRecord> = LuaCardApiState<EffectRecord> & LuaMoveImmunityHostState<EffectRecord> & LuaOperationTimingBoundaryHostState;
type CounterEffectStore<EffectRecord extends LuaCardApiEffectRecord> = {
  effects: Map<number, EffectRecord>;
  pushEffectTable: (state: unknown, id: number) => void;
};

export function installCardCounterApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetAllCounters(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetAllCounters"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAddCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("AddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveAllCounters(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveAllCounters"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanAddCounter(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsCanAddCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanRemoveCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanRemoveCounter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushHasCounter(state, session));
  lua.lua_setfield(L, -2, to_luastring("HasCounter"));
  pushBooleanGetter(L, "HasCounters", session, (card) => Boolean(card && totalCounters(card) > 0));
}

function pushGetCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  lua.lua_pushinteger(L, getCounterForActiveContext(card, counterType, hostState));
  return 1;
}

function getCounterForActiveContext<EffectRecord extends LuaCardApiEffectRecord>(
  card: DuelCardInstance | undefined,
  counterType: number,
  hostState: LuaCardCounterHostState<EffectRecord>,
): number {
  if (
    card &&
    hostState.activeContext?.eventName === "leftField" &&
    hostState.activeContext.eventCard?.uid === card.uid &&
    card.previousLocation !== undefined &&
    card.location !== card.previousLocation
  ) {
    const previousBuckets = card.previousCounterBuckets?.[counterType];
    if (previousBuckets) return (previousBuckets.permanent ?? 0) + (previousBuckets.resetWhileNegated ?? 0);
    return card.previousCounters?.[counterType] ?? 0;
  }
  return getDuelCardCounter(card, counterType);
}

function pushGetAllCounters(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  lua.lua_newtable(L);
  for (const [counterType, count] of Object.entries(getAllDuelCardCounters(card))) {
    lua.lua_pushinteger(L, Number(counterType));
    lua.lua_pushinteger(L, count);
    lua.lua_settable(L, -3);
  }
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

function pushAddCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const singly = Boolean(lua.lua_toboolean(L, 4));
  const counterTypeKey = storedCounterType(counterType);
  const amount = counterAmountToPlace(L, session, hostState, card, counterType, count, singly);
  const added = Boolean(
    card &&
      amount > 0 &&
      !luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect) &&
      addDuelCardCounter(card, counterTypeKey, amount, counterBucket(counterType)),
  );
  if (added && card) {
    markLuaOperationTimingBoundary(session, hostState);
    collectCounterEvent(session, hostState, "counterAdded", card, duelReason.effect, counterTypeKey);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushboolean(L, added);
  return 1;
}

function pushRemoveCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const card = readCard(L, session);
  const hasPlayerArgument = lua.lua_gettop(L) >= 4;
  const counterTypeIndex = hasPlayerArgument ? 3 : 2;
  const countIndex = hasPlayerArgument ? 4 : 3;
  const counterType = lua.lua_isnumber(L, counterTypeIndex) ? lua.lua_tointeger(L, counterTypeIndex) : 0;
  const count = lua.lua_isnumber(L, countIndex) ? lua.lua_tointeger(L, countIndex) : 1;
  const reasonIndex = hasPlayerArgument ? 5 : 4;
  const reason = lua.lua_isnumber(L, reasonIndex) ? lua.lua_tointeger(L, reasonIndex) : duelReason.effect;
  const removed = Boolean(card && !luaMoveBlockedByImmunity(L, session, hostState, card, reason) && removeDuelCardCounter(card, counterType, count));
  if (removed && card) {
    markLuaOperationTimingBoundary(session, hostState);
    collectCounterEvent(session, hostState, "counterRemoved", card, reason, counterType);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushboolean(L, removed);
  return 1;
}

function pushRemoveAllCounters<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const card = readCard(L, session);
  const removed = removeAllDuelCardCounters(card);
  if (removed > 0) {
    markLuaOperationTimingBoundary(session, hostState);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  lua.lua_pushinteger(L, removed);
  return 1;
}

function pushIsCanAddCounter<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardCounterHostState<EffectRecord>): number {
  const card = readCard(L, session);
  const counterType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const count = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const singly = Boolean(lua.lua_toboolean(L, 4));
  const loc = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  lua.lua_pushboolean(L, canLuaCardAddCounter(L, session, hostState, card, counterType, count, singly, loc));
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

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function totalCounters(card: DuelCardInstance): number {
  return Object.values(getAllDuelCardCounters(card)).reduce((total, value) => total + value, 0);
}

function collectCounterEvent(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, eventName: DuelEventName, card: DuelCardInstance, reason: number, counterType: number): void {
  const baseEventCode = eventName === "counterRemoved" ? 0x20000 : 0x10000;
  collectDuelTriggerEffects(session.state, eventName, card, {
    ...luaEffectReasonPayload(hostState, reason, hostState.activeContext?.player ?? session.state.turnPlayer),
    triggerEventCode: baseEventCode + storedCounterType(counterType),
  });
}

export function canLuaCardAddCounter<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: CounterEffectStore<EffectRecord>,
  card: DuelCardInstance | undefined,
  counterType: number,
  count: number,
  singly = false,
  loc = 0,
): boolean {
  if (!card) return false;
  const amount = Math.max(0, Math.floor(count));
  const locationMask = Math.max(0, Math.floor(loc));
  if (amount > 0) {
    if (locationMask === 0 && (!canAddDuelCardCounter(card, amount) || !cardIsFaceUpOnField(card))) return false;
    if (isCounterPlacementPrevented(session.state, card, createCounterCheckContext(session))) return false;
    if ((counterType & counterNeedEnable) !== 0 && isCardDisabled(session.state, card, createCounterCheckContext(session))) return false;
  }
  if (!counterPermitApplies(L, session, hostState, card, counterType, locationMask)) return false;
  const limit = counterLimit(L, session, hostState, card, storedCounterType(counterType));
  if (limit === undefined) return true;
  const checkedAmount = singly ? 1 : amount;
  return getDuelCardCounter(card, storedCounterType(counterType)) + checkedAmount <= limit;
}

function counterAmountToPlace<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardCounterHostState<EffectRecord>,
  card: DuelCardInstance | undefined,
  counterType: number,
  count: number,
  singly: boolean,
): number {
  const amount = Math.max(0, Math.floor(count));
  if (!canLuaCardAddCounter(L, session, hostState, card, counterType, amount, singly, 0) || !card) return 0;
  if (!singly) return amount;
  const limit = counterLimit(L, session, hostState, card, storedCounterType(counterType));
  if (limit === undefined) return amount;
  return Math.max(0, Math.min(amount, limit - getDuelCardCounter(card, storedCounterType(counterType))));
}

function counterPermitApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: CounterEffectStore<EffectRecord>,
  card: DuelCardInstance,
  counterType: number,
  loc: number,
): boolean {
  if ((counterType & counterWithoutPermit) !== 0) return true;
  const permitCode = effectCounterPermit + (counterType & 0xffff);
  for (const effect of registeredCounterEffects(session, hostState, card, permitCode)) {
    const range = counterEffectNumericValue(L, hostState, effect, 0);
    if (loc !== 0) {
      if ((loc & range) !== 0) return true;
      continue;
    }
    if (!cardIsFaceUpOnField(card)) continue;
    if (!locationMatchesCardMask(card, range)) continue;
    if (!counterPermitTargetApplies(L, hostState, effect, card)) continue;
    return true;
  }
  return false;
}

function counterLimit<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: CounterEffectStore<EffectRecord>,
  card: DuelCardInstance,
  counterType: number,
): number | undefined {
  let limit: number | undefined;
  for (const effect of registeredCounterEffects(session, hostState, card, effectCounterLimit + counterType)) {
    const value = Math.max(0, Math.floor(counterEffectNumericValue(L, hostState, effect, 0)));
    limit = limit === undefined ? value : Math.min(limit, value);
  }
  return limit;
}

function registeredCounterEffects<EffectRecord extends LuaCardApiEffectRecord>(
  session: DuelSession,
  hostState: CounterEffectStore<EffectRecord>,
  card: DuelCardInstance,
  code: number,
): EffectRecord[] {
  const effects: EffectRecord[] = [];
  for (const effect of hostState.effects.values()) {
    if (effect.code !== code || effect.sourceUid !== card.uid) continue;
    const registered = session.state.effects.some((candidate) => candidate.id === luaEffectDuelId(effect) && candidate.sourceUid === card.uid);
    if (registered) effects.push(effect);
  }
  return effects;
}

function counterEffectNumericValue<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  hostState: CounterEffectStore<EffectRecord>,
  effect: EffectRecord,
  fallback: number,
): number {
  if (effect.valueRef === undefined) return effect.value ?? fallback;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
  hostState.pushEffectTable(L, effect.id);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return fallback;
  }
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : fallback;
  lua.lua_pop(L, 1);
  return value;
}

function counterPermitTargetApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  hostState: CounterEffectStore<EffectRecord>,
  effect: EffectRecord,
  card: DuelCardInstance,
): boolean {
  if (effect.targetRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.targetRef);
  hostState.pushEffectTable(L, effect.id);
  pushCardTable(L, card.uid);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = Boolean(lua.lua_toboolean(L, -1));
  lua.lua_pop(L, 1);
  return result;
}

function storedCounterType(counterType: number): number {
  return counterType & ~counterNeedEnable;
}

function counterBucket(counterType: number): DuelCounterBucket {
  if ((counterType & counterWithoutPermit) !== 0 && (counterType & counterNeedEnable) === 0) return "permanent";
  return "resetWhileNegated";
}

function cardIsFaceUpOnField(card: DuelCardInstance): boolean {
  return card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone");
}

function luaEffectDuelId(effect: LuaCardApiEffectRecord): string {
  return `lua-${effect.id}${effect.code === undefined ? "" : `-${effect.code}`}`;
}

function createCounterCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
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
