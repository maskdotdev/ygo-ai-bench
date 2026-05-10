import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { collectDuelGroupedTriggerEffects, collectDuelTriggerEffects, raiseDuelEvent, raiseDuelEventWithCode } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { triggerEventFromCode } from "#lua/event-code.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid } from "#lua/api-utils.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary } from "#lua/duel-api/move.js";
import { readCardOrGroupUids, readOptionalPlayer } from "#lua/duel-api/move-readers.js";
import type { ChainLink, DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelEventRecord, DuelOperationInfo, DuelSession, PlayerId } from "#duel/types.js";

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

type OperationInfoField = "operationInfos" | "possibleOperationInfos";

export function installDuelOperationApi(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, session, hostState, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, session, hostState, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationCount(state, session, hostState, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetOperationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushClearOperationInfo(state, session, hostState, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("ClearOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, session, hostState, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetPossibleOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, session, hostState, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetPossibleOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRaiseEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RaiseEvent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRaiseSingleEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RaiseSingleEvent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckEvent"));
  lua.lua_pushcfunction(L, () => pushBreakEffect(session, hostState));
  lua.lua_setfield(L, -2, to_luastring("BreakEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAdjustInstantly(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("AdjustInstantly"));
  lua.lua_pushcfunction(L, () => pushReadjust(session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Readjust"));
  lua.lua_pushcfunction(L, () => pushAssumeReset(session));
  lua.lua_setfield(L, -2, to_luastring("AssumeReset"));
}

function pushBreakEffect(session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  markLuaOperationTimingBoundary(session, hostState);
  pushDuelLog(session.state, "breakEffect", session.state.turnPlayer, undefined, "Effect operation break");
  collectDuelTriggerEffects(session.state, "breakEffect", undefined, luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer));
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  return 0;
}

function pushAssumeReset(session: DuelSession): number {
  for (const card of session.state.cards) delete card.assumedProperties;
  return 0;
}

function pushAdjustInstantly(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  const uid = readCardUid(L, 1);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  markLuaOperationTimingBoundary(session, hostState);
  collectDuelTriggerEffects(session.state, "adjust", card, luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? card?.controller ?? session.state.turnPlayer));
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  pushDuelLog(session.state, "adjust", card?.controller ?? session.state.turnPlayer, card?.name, "Instant adjust");
  return 0;
}

function pushReadjust(session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  markLuaOperationTimingBoundary(session, hostState);
  collectDuelTriggerEffects(session.state, "adjust", undefined, luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer));
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  pushDuelLog(session.state, "adjust", session.state.turnPlayer, undefined, "Readjust");
  return 0;
}

function pushRaiseEvent(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  const eventName = triggerEventFromCode(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined);
  const eventCode = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const payload = readRaiseEventPayload(L, session);
  if (!eventName) return 0;
  markLuaOperationTimingBoundary(session, hostState);
  const eventUids = readCardOrGroupUids(L, 1);
  const eventCards = eventUids.map((uid) => session.state.cards.find((candidate) => candidate.uid === uid)).filter((card): card is DuelCardInstance => Boolean(card));
  if (eventCards.length > 0) {
    raiseOperationGroupEvent(session, eventName, eventCards, eventCode, { ...payload, eventUids });
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
  return 0;
}

function pushRaiseSingleEvent(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState): number {
  if (session.state.status === "ended") return 0;
  const uid = readCardUid(L, 1);
  const eventCode = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const eventName = triggerEventFromCode(eventCode);
  const payload = readRaiseEventPayload(L, session);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  if (card && eventName) {
    markLuaOperationTimingBoundary(session, hostState);
    raiseOperationEvent(session, eventName, card, eventCode, { ...payload, eventUids: [card.uid] });
    if (hostState.activeContext) hostState.activeOperationMoved = true;
  }
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
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
}

function readRaiseEventPayload(L: unknown, session: DuelSession): LuaRaiseEventPayload {
  const relatedEffectId = readOptionalEffectId(L, 3);
  const eventReasonPlayer = readOptionalPlayer(L, 5);
  const eventPlayer = readOptionalPlayer(L, 6);
  const relatedEffect = relatedEffectId === undefined ? undefined : findLuaRelatedEffect(session, relatedEffectId);
  return {
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(relatedEffect?.sourceUid === undefined ? {} : { eventReasonCardUid: relatedEffect.sourceUid }),
    ...(relatedEffectId === undefined ? {} : { eventReasonEffectId: relatedEffectId }),
    ...(lua.lua_isnumber(L, 4) ? { eventReason: lua.lua_tointeger(L, 4) } : {}),
    ...(eventReasonPlayer === undefined ? {} : { eventReasonPlayer }),
    ...(eventPlayer === undefined ? {} : { eventPlayer }),
    ...(lua.lua_isnumber(L, 7) ? { eventValue: lua.lua_tointeger(L, 7) } : {}),
  };
}

function findLuaRelatedEffect(session: DuelSession, relatedEffectId: number): DuelEffectDefinition | undefined {
  const prefix = `lua-${relatedEffectId}`;
  return session.state.effects.find((effect) => effect.id === prefix || effect.id.startsWith(`${prefix}-`));
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

function raiseOperationGroupEvent(session: DuelSession, eventName: DuelEventName, cards: DuelCardInstance[], eventCode: number | undefined, payload: LuaRaiseEventPayload): void {
  collectDuelGroupedTriggerEffects(session.state, eventName, cards, eventCode === undefined ? payload : { ...payload, eventCode });
}

function pushSetOperationInfo(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState, operationInfos: LuaDuelOperationInfo[]): number {
  const field = operationInfoField(hostState, operationInfos);
  const info: LuaDuelOperationInfo = {
    chainIndex: operationInfoChainIndex(session, hostState, lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0, "set"),
    category: lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0,
    targetUids: readCardOrGroupUids(L, 3),
    count: lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0,
    player: readOptionalPlayer(L, 5) ?? 0,
    parameter: lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0,
  };
  const existingIndex = operationInfos.findIndex((candidate) => candidate.chainIndex === info.chainIndex && candidate.category === info.category);
  if (existingIndex >= 0) operationInfos[existingIndex] = info;
  else operationInfos.push(info);
  syncContextOperationInfo(hostState, field, info);
  return 0;
}

function pushGetOperationInfo(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState, operationInfos: LuaDuelOperationInfo[]): number {
  const field = operationInfoField(hostState, operationInfos);
  const chainIndex = operationInfoChainIndex(session, hostState, lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0, "get");
  const category = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const info = findOperationInfo(operationInfosForChain(session, hostState, operationInfos, field, chainIndex), category);
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

function pushGetOperationCount(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState, operationInfos: LuaDuelOperationInfo[]): number {
  const field = operationInfoField(hostState, operationInfos);
  const chainIndex = operationInfoChainIndex(session, hostState, lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0, "get");
  lua.lua_pushinteger(L, operationInfosForChain(session, hostState, operationInfos, field, chainIndex).length);
  return 1;
}

function pushClearOperationInfo(L: unknown, session: DuelSession, hostState: LuaDuelOperationApiHostState, operationInfos: LuaDuelOperationInfo[]): number {
  const field = operationInfoField(hostState, operationInfos);
  const chainIndex = operationInfoChainIndex(session, hostState, lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0, "get");
  const category = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate || candidate.chainIndex !== chainIndex) continue;
    if (category === undefined || operationInfoCategoryMatches(candidate.category, category)) operationInfos.splice(index, 1);
  }
  clearContextOperationInfo(session, hostState, field, chainIndex, category);
  return 0;
}

function findOperationInfo(operationInfos: LuaDuelOperationInfo[], category: number): LuaDuelOperationInfo | undefined {
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate) continue;
    if (operationInfoCategoryMatches(candidate.category, category)) return candidate;
  }
  return undefined;
}

function operationInfoCategoryMatches(stored: number, requested: number): boolean {
  if (requested === 0) return stored === 0;
  return stored === requested || (stored & requested) === requested;
}

function operationInfoChainIndex(session: DuelSession, hostState: LuaDuelOperationApiHostState, requestedIndex: number, mode: "get" | "set"): number {
  if (requestedIndex !== 0) return requestedIndex;
  const contextChainIndex = hostState.activeContext ? contextOperationInfoChainIndex(session, hostState.activeContext) : undefined;
  if (contextChainIndex !== undefined) return contextChainIndex;
  if (mode === "get" && session.state.chain.length > 0) return session.state.chain.length;
  return 0;
}

function operationInfoField(hostState: LuaDuelOperationApiHostState, operationInfos: LuaDuelOperationInfo[]): OperationInfoField {
  return operationInfos === hostState.possibleOperationInfos ? "possibleOperationInfos" : "operationInfos";
}

function operationInfosForChain(
  session: DuelSession,
  hostState: LuaDuelOperationApiHostState,
  operationInfos: LuaDuelOperationInfo[],
  field: OperationInfoField,
  chainIndex: number,
): LuaDuelOperationInfo[] {
  const link = chainLinkForOperationInfo(session, hostState, chainIndex);
  if (link) return (link[field] ?? []).map((info) => ({ chainIndex, ...info }));
  return operationInfos.filter((info) => info.chainIndex === chainIndex);
}

function syncContextOperationInfo(hostState: LuaDuelOperationApiHostState, field: OperationInfoField, info: LuaDuelOperationInfo): void {
  const ctx = hostState.activeContext;
  if (!ctx || ctx.checkOnly) return;
  upsertDuelOperationInfo(ensureContextOperationInfoList(ctx, field), info);
  if (ctx.chainLink) upsertDuelOperationInfo(ensureChainOperationInfoList(ctx.chainLink, field), info);
}

function clearContextOperationInfo(session: DuelSession, hostState: LuaDuelOperationApiHostState, field: OperationInfoField, chainIndex: number, category: number | undefined): void {
  const ctx = hostState.activeContext;
  if (ctx && contextOperationInfoChainIndex(session, ctx) === chainIndex) clearDuelOperationInfo(ctx[field], category);
  const link = chainLinkForOperationInfo(session, hostState, chainIndex);
  clearDuelOperationInfo(link?.[field], category);
}

function upsertDuelOperationInfo(infos: DuelOperationInfo[], info: LuaDuelOperationInfo): void {
  const next = duelOperationInfo(info);
  const existingIndex = infos.findIndex((candidate) => candidate.category === next.category);
  if (existingIndex >= 0) infos[existingIndex] = next;
  else infos.push(next);
}

function clearDuelOperationInfo(infos: DuelOperationInfo[] | undefined, category: number | undefined): void {
  if (!infos) return;
  if (category === undefined) {
    infos.splice(0, infos.length);
    return;
  }
  for (let index = infos.length - 1; index >= 0; index -= 1) {
    const info = infos[index];
    if (info && operationInfoCategoryMatches(info.category, category)) infos.splice(index, 1);
  }
}

function duelOperationInfo(info: LuaDuelOperationInfo): DuelOperationInfo {
  return {
    category: info.category,
    targetUids: [...info.targetUids],
    count: info.count,
    player: info.player,
    parameter: info.parameter,
  };
}

function ensureChainOperationInfoList(link: ChainLink, field: OperationInfoField): DuelOperationInfo[] {
  if (field === "operationInfos") {
    link.operationInfos ??= [];
    return link.operationInfos;
  }
  link.possibleOperationInfos ??= [];
  return link.possibleOperationInfos;
}

function ensureContextOperationInfoList(ctx: DuelEffectContext, field: OperationInfoField): DuelOperationInfo[] {
  if (field === "operationInfos") {
    ctx.operationInfos ??= [];
    return ctx.operationInfos;
  }
  ctx.possibleOperationInfos ??= [];
  return ctx.possibleOperationInfos;
}

function chainLinkForOperationInfo(session: DuelSession, hostState: LuaDuelOperationApiHostState, chainIndex: number): ChainLink | undefined {
  const active = hostState.activeContext?.chainLink;
  if (active && (active.chainIndex ?? 0) === chainIndex) return active;
  return session.state.chain.find((link, index) => (link.chainIndex ?? index + 1) === chainIndex);
}

function contextOperationInfoChainIndex(session: DuelSession, ctx: DuelEffectContext): number | undefined {
  if (ctx.chainLink?.chainIndex !== undefined) return ctx.chainLink.chainIndex;
  if (!ctx.checkOnly) return session.state.chain.length + 1;
  return undefined;
}
