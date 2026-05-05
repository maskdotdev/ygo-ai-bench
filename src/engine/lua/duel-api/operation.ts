import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { collectDuelTriggerEffects, raiseDuelEvent, raiseDuelEventWithCode } from "#duel/core.js";
import { triggerEventFromCode } from "#lua/event-code.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid } from "#lua/api-utils.js";
import { markLuaOperationTimingBoundary } from "#lua/duel-api/move.js";
import { readCardOrGroupUids, readOptionalPlayer } from "#lua/duel-api/move-readers.js";
import type { DuelCardInstance, DuelEffectContext, DuelEventName, DuelEventRecord, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelOperationApiHostState {
  operationInfos: LuaDuelOperationInfo[];
  possibleOperationInfos: LuaDuelOperationInfo[];
  activeContext?: DuelEffectContext | undefined;
  activeOperationTriggerStart?: number | undefined;
  activeOperationMoved?: boolean;
  pushEffectTable: (state: unknown, id: number) => void;
}

export interface LuaDuelOperationInfo {
  chainIndex: number;
  category: number;
  targetUids: string[];
  count: number;
  player: PlayerId;
  parameter: number;
}

export function installDuelOperationApi(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationCount(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetOperationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushClearOperationInfo(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("ClearOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetPossibleOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetPossibleOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRaiseEvent(state, session));
  lua.lua_setfield(L, -2, to_luastring("RaiseEvent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRaiseSingleEvent(state, session));
  lua.lua_setfield(L, -2, to_luastring("RaiseSingleEvent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckEvent"));
  lua.lua_pushcfunction(L, () => pushBreakEffect(session, hostState));
  lua.lua_setfield(L, -2, to_luastring("BreakEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAdjustInstantly(state, session));
  lua.lua_setfield(L, -2, to_luastring("AdjustInstantly"));
  lua.lua_pushcfunction(L, () => pushReadjust(session));
  lua.lua_setfield(L, -2, to_luastring("Readjust"));
  lua.lua_pushcfunction(L, () => pushAssumeReset(session));
  lua.lua_setfield(L, -2, to_luastring("AssumeReset"));
}

function pushBreakEffect(session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  markLuaOperationTimingBoundary(session, hostState);
  pushDuelLog(session.state, "breakEffect", session.state.turnPlayer, undefined, "Effect operation break");
  raiseDuelEvent(session.state, "breakEffect");
  return 0;
}

function pushAssumeReset(session: DuelSession): number {
  for (const card of session.state.cards) delete card.assumedProperties;
  return 0;
}

function pushAdjustInstantly(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const uid = readCardUid(L, 1);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  raiseDuelEvent(session.state, "adjust", card);
  pushDuelLog(session.state, "adjust", card?.controller ?? session.state.turnPlayer, card?.name, "Instant adjust");
  return 0;
}

function pushReadjust(session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  raiseDuelEvent(session.state, "adjust");
  pushDuelLog(session.state, "adjust", session.state.turnPlayer, undefined, "Readjust");
  return 0;
}

function pushRaiseEvent(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const eventName = triggerEventFromCode(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined);
  const eventCode = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const payload = readRaiseEventPayload(L);
  if (!eventName) return 0;
  const eventUids = readCardOrGroupUids(L, 1);
  for (const uid of eventUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (card) raiseOperationEvent(session, eventName, card, eventCode, { ...payload, eventUids });
  }
  return 0;
}

function pushRaiseSingleEvent(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const uid = readCardUid(L, 1);
  const eventCode = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const eventName = triggerEventFromCode(eventCode);
  const payload = readRaiseEventPayload(L);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  if (card && eventName) raiseOperationEvent(session, eventName, card, eventCode, { ...payload, eventUids: [card.uid] });
  return 0;
}

function pushCheckEvent(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  const eventCode = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : undefined;
  const eventName = triggerEventFromCode(eventCode);
  const event = eventName ? matchingEventRecord(session, eventName, eventCode) : undefined;
  lua.lua_pushboolean(L, Boolean(event));
  if (!event || !lua.lua_toboolean(L, 2)) return 1;
  pushEventRecordPayload(L, session, hostState, event);
  return 7;
}

function matchingEventRecord(session: DuelSession, eventName: DuelEventName, eventCode: number | undefined): DuelEventRecord | undefined {
  for (let index = session.state.eventHistory.length - 1; index >= 0; index -= 1) {
    const event = session.state.eventHistory[index];
    if (!event || event.eventName !== eventName) continue;
    if (eventCode !== undefined && event.eventCode !== eventCode) continue;
    return event;
  }
  return undefined;
}

function pushEventRecordPayload(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState, event: DuelEventRecord): void {
  const eventCard = event.eventCardUid === undefined ? undefined : session.state.cards.find((card) => card.uid === event.eventCardUid);
  pushGroupTable(L, event.eventUids ?? (eventCard ? [eventCard.uid] : []));
  lua.lua_pushinteger(L, event.eventPlayer ?? eventCard?.controller ?? session.state.turnPlayer);
  lua.lua_pushinteger(L, event.eventValue ?? 0);
  if (event.relatedEffectId !== undefined && Number.isFinite(event.relatedEffectId)) hostState.pushEffectTable(L, event.relatedEffectId);
  else lua.lua_pushnil(L);
  lua.lua_pushinteger(L, event.eventReason ?? eventCard?.reason ?? 0);
  lua.lua_pushinteger(L, event.eventReasonPlayer ?? eventCard?.reasonPlayer ?? eventCard?.controller ?? session.state.turnPlayer);
}

interface LuaRaiseEventPayload {
  relatedEffectId?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
}

function readRaiseEventPayload(L: unknown): LuaRaiseEventPayload {
  const relatedEffectId = readOptionalEffectId(L, 3);
  const eventReasonPlayer = readOptionalPlayer(L, 5);
  const eventPlayer = readOptionalPlayer(L, 6);
  return {
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(lua.lua_isnumber(L, 4) ? { eventReason: lua.lua_tointeger(L, 4) } : {}),
    ...(eventReasonPlayer === undefined ? {} : { eventReasonPlayer }),
    ...(eventPlayer === undefined ? {} : { eventPlayer }),
    ...(lua.lua_isnumber(L, 7) ? { eventValue: lua.lua_tointeger(L, 7) } : {}),
  };
}

function readOptionalEffectId(L: unknown, index: number): number | undefined {
  if (!lua.lua_istable(L, index)) return undefined;
  lua.lua_getfield(L, index, to_luastring("__effect_id"));
  const id = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return id === undefined || !Number.isFinite(id) ? undefined : id;
}

function raiseOperationEvent(session: DuelSession, eventName: DuelEventName, card: DuelCardInstance, eventCode: number | undefined, payload: LuaRaiseEventPayload): void {
  if (eventCode !== undefined) raiseDuelEventWithCode(session.state, eventName, eventCode, card, payload);
  else if (Object.keys(payload).length > 0) collectDuelTriggerEffects(session.state, eventName, card, payload);
  else raiseDuelEvent(session.state, eventName, card);
}

function pushSetOperationInfo(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const info: LuaDuelOperationInfo = {
    chainIndex: lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0,
    category: lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0,
    targetUids: readCardOrGroupUids(L, 3),
    count: lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0,
    player: readOptionalPlayer(L, 5) ?? 0,
    parameter: lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0,
  };
  const existingIndex = operationInfos.findIndex((candidate) => candidate.chainIndex === info.chainIndex && candidate.category === info.category);
  if (existingIndex >= 0) operationInfos[existingIndex] = info;
  else operationInfos.push(info);
  return 0;
}

function pushGetOperationInfo(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const chainIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  const category = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const info = findOperationInfo(operationInfos, chainIndex, category);
  if (!info) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  lua.lua_pushboolean(L, true);
  pushGroupTable(L, info.targetUids);
  lua.lua_pushinteger(L, info.count);
  lua.lua_pushinteger(L, info.player);
  lua.lua_pushinteger(L, info.parameter);
  return 5;
}

function pushGetOperationCount(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const chainIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  lua.lua_pushinteger(L, operationInfos.filter((info) => info.chainIndex === chainIndex).length);
  return 1;
}

function pushClearOperationInfo(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const chainIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  const category = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate || candidate.chainIndex !== chainIndex) continue;
    if (category === undefined || candidate.category === category) operationInfos.splice(index, 1);
  }
  return 0;
}

function findOperationInfo(operationInfos: LuaDuelOperationInfo[], chainIndex: number, category: number): LuaDuelOperationInfo | undefined {
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate) continue;
    if (candidate.chainIndex === chainIndex && candidate.category === category) return candidate;
  }
  return undefined;
}
