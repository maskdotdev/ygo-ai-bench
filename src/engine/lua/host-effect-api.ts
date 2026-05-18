import fengari from "fengari";
import { registerEffect } from "#duel/core.js";
import { cleanupRemovedDuelEffect } from "#duel/effect-reset.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { locationsFromMask, positionMaskFromPosition, readCardUid, readGroupUids, readTableNumberField } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { callLuaEffectBattleDamageValue, callLuaEffectForceMonsterZoneValue, callLuaEffectLifePointValue, callLuaEffectStatValue, callLuaEffectValueCardPredicate, callLuaEffectValuePredicate } from "#lua/effect-value-callbacks.js";
import { knownLuaEffectConditionDescriptor } from "#lua/effect-condition-descriptor.js";
import { knownLuaEffectCostDescriptor } from "#lua/effect-cost-descriptor.js";
import { knownLuaEffectTargetDescriptor } from "#lua/effect-target-descriptor.js";
import { knownLuaEffectValueDescriptor } from "#lua/effect-value-descriptor.js";
import { luaValueDescriptorStatValue } from "#lua/effect-value-descriptor-callbacks.js";
import { locationMaskFromLocation, locationMaskFromLocations } from "#lua/effect-location-mask.js";
import { installEffectCompatibilityApi } from "#lua/effect-compatibility-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { applyLuaContinuousSetControlEffects } from "#lua/duel-api/move-control.js";
import { pushGroupTable } from "#lua/group-api.js";
import { triggerEventFromCode } from "#lua/event-code.js";
import { readLuaError, runLuaPromptCoroutineFromStack } from "#lua/host-script-api.js";
import { normalizeLuaDamageModifier, normalizeLuaUnsignedInteger, toLuaSigned32 } from "#lua/numeric-utils.js";
import { materializeSkipDrawPhaseEffect } from "#lua/phase-skip-effects.js";
import { activeTypeFlags, canUseLuaEffectCount, clearLuaEffectCountUsage, effectController, firstFiniteNumber, markLuaEffectCountUsed, normalizeLuaPlayer, normalizePlayer, relatedEffectIdFromChainLink, relatedEffectIdFromEventHistory, sourceCard } from "#lua/host-effect-state-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord, LuaHostState, LuaPromptCoroutineResult } from "#lua/host-types.js";
const { lua, lauxlib, to_luastring } = fengari;
const luaEffectTypeSingle = 0x1, luaEffectTypeField = 0x2, luaEffectTypeFlip = 0x20, luaResetEvent = 0x1000, luaResetToField = 0x1000000;
const luaEventFlip = 1001;
const luaEffectSummonProc = 32, luaEffectLimitSummonProc = 33, luaEffectSpecialSummonProc = 34, luaEffectIndestructibleEffect = 41, luaEffectFusionSubstitute = 234, luaEffectDisableField = 260;
export function installEffectApi(L: unknown, hostState: LuaHostState, readLuaError: (state: unknown) => string): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = nextLuaEffectId(hostState);
    const sourceUid = readCardUid(state, 1);
    hostState.effects.set(id, { id, typeFlags: 0, ...(sourceUid === undefined ? {} : { sourceUid, ownerUid: sourceUid }) });
    pushLuaEffectTable(state, id, hostState);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = nextLuaEffectId(hostState);
    hostState.effects.set(id, { id, typeFlags: 0, isGlobal: true });
    pushLuaEffectTable(state, id, hostState);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GlobalEffect"));
  lua.lua_setglobal(L, to_luastring("Effect"));
  installEffectCompatibilityApi(L, readLuaError);
}

export function installGetIdCompatibilityApi(L: unknown, hostState: LuaHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const code = hostState.currentScriptCardCode;
    if (!code) {
      lua.lua_pushnil(state);
      lua.lua_pushinteger(state, 0);
      return 2;
    }
    const globalName = `c${code}`;
    lua.lua_getglobal(state, to_luastring(globalName));
    if (!lua.lua_istable(state, -1)) {
      lua.lua_pop(state, 1);
      lua.lua_newtable(state);
      lua.lua_pushvalue(state, -1);
      lua.lua_setglobal(state, to_luastring(globalName));
    }
    lua.lua_pushinteger(state, Number(code));
    return 2;
  });
  lua.lua_setglobal(L, to_luastring("GetID"));
}

export function pushLuaEffectTable(L: unknown, id: number, hostState: LuaHostState, reuseTableRef = true): void {
  const { effects, session } = hostState;
  const existing = effects.get(id);
  if (reuseTableRef && existing?.tableRef !== undefined) {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, existing.tableRef);
    return;
  }
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, id);
  lua.lua_setfield(L, -2, to_luastring("__effect_id"));
  pushEffectMethod(L, effects, "Clone", (state, effect) => {
    const cloneId = cloneLuaEffectRecord(hostState, effect);
    pushLuaEffectTable(state, cloneId, hostState);
    return 1;
  });
  pushEffectMethod(L, effects, "GetHandler", (state, effect) => {
    if (!effect.sourceUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, effect.sourceUid);
    return 1;
  });
  pushEffectMethod(L, effects, "GetHandlerPlayer", (state, effect) => {
    const source = effect.sourceUid ? session.state.cards.find((candidate) => candidate.uid === effect.sourceUid) : undefined;
    lua.lua_pushinteger(state, source?.controller ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "GetOwner", (state, effect) => {
    const ownerUid = effect.ownerUid ?? effect.sourceUid;
    if (!ownerUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, ownerUid);
    return 1;
  });
  pushEffectMethod(L, effects, "GetActivateLocation", (state, effect) => {
    lua.lua_pushinteger(state, locationMaskFromLocation(hostState.activeContext?.activationLocation ?? sourceCard(session, effect)?.location));
    return 1;
  });
  pushEffectMethod(L, effects, "GetActivateSequence", (state, effect) => {
    lua.lua_pushinteger(state, hostState.activeContext?.activationSequence ?? sourceCard(session, effect)?.sequence ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetOwnerPlayer", (state, effect) => {
    effect.ownerPlayer = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    return 0;
  });
  pushEffectMethod(L, effects, "GetOwnerPlayer", (state, effect) => {
    lua.lua_pushinteger(state, effect.ownerPlayer ?? effectController(session, effect));
    return 1;
  });
  pushEffectMethod(L, effects, "GetType", getEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "GetCode", getEffectNumberField("code"));
  pushEffectMethod(L, effects, "GetFieldID", (state, effect) => {
    lua.lua_pushinteger(state, effect.id);
    return 1;
  });
  pushEffectMethod(L, effects, "GetDescription", getEffectNumberField("description"));
  pushEffectMethod(L, effects, "GetCategory", getEffectNumberField("category"));
  pushEffectMethod(L, effects, "GetProperty", getEffectNumberField("property"));
  pushEffectMethod(L, effects, "IsHasType", hasEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "IsHasCategory", hasEffectNumberField("category"));
  pushEffectMethod(L, effects, "IsHasProperty", hasEffectNumberField("property"));
  pushEffectMethod(L, effects, "GetActiveType", (state, effect) => {
    lua.lua_pushinteger(state, activeTypeFlags(sourceCard(session, effect), session));
    return 1;
  });
  pushEffectMethod(L, effects, "IsActiveType", (state, effect) => {
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const ownerType = activeTypeFlags(sourceCard(session, effect), session);
    lua.lua_pushboolean(state, requested !== 0 && (ownerType & requested) !== 0);
    return 1;
  });
  pushEffectMethod(L, effects, "IsActivated", (state, effect) => {
    lua.lua_pushboolean(state, ((effect.typeFlags ?? 0) & (0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400)) !== 0);
    return 1;
  });
  pushEffectMethod(L, effects, "IsActivatable", (state, effect) => {
    lua.lua_pushboolean(state, effect.sourceUid !== undefined || effect.isGlobal);
    return 1;
  });
  pushEffectMethod(L, effects, "SetType", setEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "SetCode", setEffectNumberField("code"));
  pushEffectMethod(L, effects, "SetDescription", setEffectNumberField("description"));
  pushEffectMethod(L, effects, "SetCategory", setEffectNumberField("category"));
  pushEffectMethod(L, effects, "SetProperty", (state, effect) => { if (lua.lua_isnumber(state, 2)) effect.property = normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 2)); syncRegisteredDuelEffectProperty(hostState, effect); return 0; });
  pushEffectMethod(L, effects, "SetHintTiming", (state, effect) => {
    const primary = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (primary === undefined) return 0;
    const secondary = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    effect.hintTiming = secondary === undefined ? [primary] : [primary, secondary];
    return 0;
  });
  pushEffectMethod(L, effects, "SetLabel", (state, effect) => {
    const labels = Array.from({ length: Math.max(0, lua.lua_gettop(state) - 1) }, (_, index) => lua.lua_isnumber(state, index + 2) ? lua.lua_tointeger(state, index + 2) : 0);
    const label = labels[0] ?? 0; effect.label = label;
    if (labels.length > 1) effect.labels = labels; else delete effect.labels;
    if (hostState.activeLuaEffectId === effect.id && hostState.activeContext) {
      syncActiveLabels(hostState, label, labels);
    }
    return 0;
  });
  pushEffectMethod(L, effects, "GetLabel", (state, effect) => {
    const labels = effect.labels ?? [effect.label ?? 0];
    for (const label of labels) lua.lua_pushinteger(state, label); return labels.length;
  });
  pushEffectMethod(L, effects, "SetLabelObject", (state, effect) => {
    if (effect.labelObjectRef !== undefined) lauxlib.luaL_unref(state, lua.LUA_REGISTRYINDEX, effect.labelObjectRef);
    delete effect.labelObjectId; delete effect.labelObjectUid; delete effect.labelObjectUids;
    if (lua.lua_isnoneornil(state, 2)) { delete effect.labelObjectRef; syncActiveLabelObject(hostState, effect); syncRegisteredDuelEffectLabelObject(hostState, effect); return 0; }
    const labelObjectId = readTableNumberField(state, 2, "__effect_id");
    if (labelObjectId !== undefined) effect.labelObjectId = labelObjectId;
    const labelObjectUid = readCardUid(state, 2);
    if (labelObjectUid !== undefined) effect.labelObjectUid = labelObjectUid;
    const labelObjectUids = labelObjectUid === undefined ? readGroupUids(state, 2) : [];
    if (labelObjectUids.length > 0) effect.labelObjectUids = labelObjectUids;
    lua.lua_pushvalue(state, 2);
    effect.labelObjectRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    syncActiveLabelObject(hostState, effect, labelObjectUid, labelObjectUids.length > 0 ? labelObjectUids : undefined);
    syncRegisteredDuelEffectLabelObject(hostState, effect);
    return 0;
  });
  pushEffectMethod(L, effects, "GetLabelObject", (state, effect) => {
    if (effect.labelObjectRef === undefined) lua.lua_pushnil(state);
    else lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, effect.labelObjectRef);
    return 1;
  });
  pushEffectMethod(L, effects, "SetValue", (state, effect) => {
    if (effect.valueRef !== undefined) lauxlib.luaL_unref(state, lua.LUA_REGISTRYINDEX, effect.valueRef);
    delete effect.valueRef; delete effect.value; delete effect.valueDescriptor;
    if (lua.lua_isfunction(state, 2)) {
      const valueDescriptor = knownLuaEffectValueDescriptor(state, 2, hostState);
      if (effect.code === luaEffectIndestructibleEffect && valueDescriptor === "cannot-be-effect-target:opponent") effect.valueDescriptor = "indestructible:opponent";
      else if (valueDescriptor !== undefined) effect.valueDescriptor = valueDescriptor;
      lua.lua_pushvalue(state, 2);
      effect.valueRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    }
    else if (lua.lua_isnumber(state, 2)) effect.value = readLuaEffectValueNumber(state, 2);
    return 0;
  });
  pushEffectMethod(L, effects, "GetValue", (state, effect) => {
    if (effect.valueRef !== undefined) lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, effect.valueRef);
    else pushLuaEffectValueNumber(state, effect.value ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetTargetRange", (state, effect) => {
    const selfRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0; const opponentRange = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined; effect.targetRange = opponentRange === undefined ? [selfRange] : [selfRange, opponentRange];
    return 0;
  });
  pushEffectMethod(L, effects, "SetAbsoluteRange", (state, effect) => {
    const referencePlayer = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : effectController(session, effect); const referenceRange = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0; const otherRange = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0; effect.targetRange = referencePlayer === effectController(session, effect) ? [referenceRange, otherRange] : [otherRange, referenceRange];
    return 0;
  });
  pushEffectMethod(L, effects, "GetTargetRange", (state, effect) => {
    lua.lua_pushinteger(state, effect.targetRange?.[0] ?? 0); lua.lua_pushinteger(state, effect.targetRange?.[1] ?? 0); return 2;
  });
  pushEffectMethod(L, effects, "SetRange", (state, effect) => {
    const firstRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (firstRange !== undefined) effect.range = locationsFromMask(firstRange);
    return 0;
  });
  pushEffectMethod(L, effects, "GetRange", (state, effect) => {
    lua.lua_pushinteger(state, locationMaskFromLocations(effect.range ?? []));
    return 1;
  });
  pushEffectMethod(L, effects, "SetCountLimit", (state, effect) => {
    effect.countLimit = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    const countCode = readLuaCountLimitCode(state, 3, 4);
    if (countCode !== undefined) effect.countLimitCode = countCode;
    return 0;
  });
  pushEffectMethod(L, effects, "GetCountLimit", (state, effect) => {
    lua.lua_pushinteger(state, effect.countLimit ?? 0);
    lua.lua_pushinteger(state, effect.countLimitCode ?? 0);
    return 2;
  });
  pushEffectMethod(L, effects, "CheckCountLimit", (state, effect) => {
    const player = normalizeLuaPlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : effect.ownerPlayer ?? 0);
    lua.lua_pushboolean(state, canUseLuaEffectCount(hostState, effect, player));
    return 1;
  });
  pushEffectMethod(L, effects, "UseCountLimit", (state, effect) => {
    const player = normalizeLuaPlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : effect.ownerPlayer ?? 0);
    const count = Math.max(1, lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1);
    markLuaEffectCountUsed(hostState, effect, player, count);
    return 0;
  });
  pushEffectMethod(L, effects, "SetReset", (state, effect) => {
    const flags = lua.lua_isnumber(state, 2) ? normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 2)) : 0;
    const count = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    effect.reset = count === undefined ? { flags } : { flags, count };
    return 0;
  });
  pushEffectMethod(L, effects, "GetReset", (state, effect) => {
    pushLuaEffectValueNumber(state, effect.reset?.flags ?? 0);
    lua.lua_pushinteger(state, effect.reset?.count ?? 0);
    return 2;
  });
  pushEffectMethod(L, effects, "Reset", (state, effect) => {
    deleteRegisteredLuaEffects(session, effect);
    effect.countLimit = 0;
    delete effect.countLimitCode;
    delete effect.reset;
    clearLuaEffectCountUsage(hostState, effect);
    return 0;
  });
  pushEffectMethod(L, effects, "Delete", (state, effect) => {
    deleteRegisteredLuaEffects(session, effect);
    if (effect.tableRef !== undefined) lauxlib.luaL_unref(state, lua.LUA_REGISTRYINDEX, effect.tableRef);
    effects.delete(effect.id);
    return 0;
  });
  pushEffectMethod(L, effects, "SetCondition", setEffectFunctionField("conditionRef", hostState));
  pushEffectMethod(L, effects, "SetCost", setEffectFunctionField("costRef", hostState));
  pushEffectMethod(L, effects, "SetTarget", setEffectFunctionField("targetRef", hostState));
  pushEffectMethod(L, effects, "GetCondition", getEffectFunctionField("conditionRef"));
  pushEffectMethod(L, effects, "GetCost", getEffectFunctionField("costRef"));
  pushEffectMethod(L, effects, "GetTarget", getEffectFunctionField("targetRef"));
  pushEffectMethod(L, effects, "GetOperation", getEffectFunctionField("operationRef"));
  pushEffectMethod(L, effects, "SetOperation", (state, effect) => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect.operationRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  });
  const effect = effects.get(id);
  if (effect) {
    lua.lua_pushvalue(L, -1);
    effect.tableRef = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  }
}

function pushEffectMethod(L: unknown, effects: Map<number, LuaEffectRecord>, name: string, handler: (state: unknown, effect: LuaEffectRecord) => number): void {
  lua.lua_pushjsfunction(L, (state: unknown) => {
    try {
      const effectId = readTableNumberField(state, 1, "__effect_id");
      const effect = effectId === undefined ? undefined : effects.get(effectId);
      return effect ? handler(state, effect) : 0;
    } catch (error) {
      return lauxlib.luaL_error(state, to_luastring(error instanceof Error ? error.message : String(error)));
    }
  });
  lua.lua_setfield(L, -2, to_luastring(name));
}

function cloneLuaEffectRecord(hostState: LuaHostState, effect: LuaEffectRecord): number {
  const id = nextLuaEffectId(hostState);
  const { tableRef: _tableRef, ...cloneSource } = effect;
  const clone: LuaEffectRecord = { ...cloneSource, id };
  if (effect.range) clone.range = [...effect.range];
  if (effect.targetRange) clone.targetRange = [...effect.targetRange];
  if (effect.hintTiming) clone.hintTiming = [...effect.hintTiming];
  if (effect.reset) clone.reset = { ...effect.reset };
  hostState.effects.set(id, clone);
  return id;
}

function nextLuaEffectId(hostState: LuaHostState): number { while (hostState.session.state.effects.some((effect) => effect.id === `lua-${hostState.nextEffectId}` || effect.id.startsWith(`lua-${hostState.nextEffectId}-`))) hostState.nextEffectId += 1; return hostState.nextEffectId++; }

export function majesticCopyLuaEffects(L: unknown, hostState: LuaHostState, receiverUid: string, sourceUid: string, reset?: number): number {
  if (hostState.session.state.status === "ended") return 0;
  const receiver = hostState.session.state.cards.find((card) => card.uid === receiverUid);
  if (!receiver) return 0;
  let count = 0;
  for (const effect of [...hostState.effects.values()]) {
    if (effect.sourceUid !== sourceUid || effect.isGlobal) continue;
    const id = cloneLuaEffectRecord(hostState, effect);
    const clone = hostState.effects.get(id);
    if (!clone) continue;
    clone.sourceUid = receiverUid;
    if (reset !== undefined) clone.reset = { flags: reset };
    registerEffect(hostState.session, toDuelEffect(receiver, clone, L, hostState));
    count += 1;
  }
  return count;
}

function deleteRegisteredLuaEffects(session: DuelSession, effect: LuaEffectRecord): void {
  session.state.effects = session.state.effects.filter((candidate) => {
    if (candidate.id !== luaEffectDuelId(effect)) return true;
    const remove = effect.sourceUid === undefined || candidate.sourceUid === effect.sourceUid;
    if (remove) cleanupRemovedDuelEffect(session.state, candidate);
    return !remove;
  });
}

function luaEffectDuelId(effect: LuaEffectRecord): string {
  return `lua-${effect.id}${effect.code === undefined ? "" : `-${effect.code}`}`;
}

function luaEffectRegistryKey(card: DuelCardInstance, effect: LuaEffectRecord, hostState: LuaHostState): string {
  if (effect.isGlobal) return `lua:global:${luaEffectDuelId(effect)}`;
  const owner = effect.ownerUid === undefined ? undefined : hostState.session.state.cards.find((candidate) => candidate.uid === effect.ownerUid);
  return `lua:${owner?.code ?? card.code}:${luaEffectDuelId(effect)}`;
}

export function registerLuaEffect(L: unknown, hostState: LuaHostState, id: number, player: PlayerId): boolean {
  if (hostState.session.state.status === "ended") return false;
  const luaEffect = hostState.effects.get(id);
  const source =
    luaEffect?.sourceUid === undefined
      ? hostState.session.state.cards.find((card) => card.controller === player) ?? hostState.session.state.cards[0]
      : hostState.session.state.cards.find((card) => card.uid === luaEffect.sourceUid);
  if (!luaEffect || !source) return false;
  luaEffect.ownerPlayer = player;
  const effect = toDuelEffect(source, luaEffect, L, hostState);
  if (luaEffect.range === undefined) effect.range = [...duelLocations];
  if ((luaEffect.typeFlags & luaEffectTypeField) !== 0 && effect.reset) effect.reset = { ...effect.reset, flags: (effect.reset.flags & ~luaResetEvent) >>> 0 };
  if (materializeSkipDrawPhaseEffect(hostState.session, source, effect)) return true;
  registerEffect(hostState.session, effect);
  return true;
}

function setEffectNumberField(field: "typeFlags" | "code" | "description" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (lua.lua_isnumber(state, 2)) effect[field] = normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 2));
    return 0;
  };
}

function readLuaEffectValueNumber(L: unknown, index: number): number {
  return normalizeLuaDamageModifier(lua.lua_tonumber(L, index));
}

function pushLuaEffectValueNumber(L: unknown, value: number): void {
  const signed = toLuaSigned32(value);
  if (signed !== undefined) lua.lua_pushinteger(L, signed);
  else lua.lua_pushnumber(L, value);
}

function readLuaCountLimitCode(L: unknown, codeIndex: number, flagsIndex: number): number | undefined {
  if (lua.lua_isnumber(L, codeIndex)) return lua.lua_tointeger(L, codeIndex);
  if (!lua.lua_istable(L, codeIndex)) return undefined;
  const absoluteIndex = lua.lua_absindex(L, codeIndex);
  const base = readLuaIntegerArrayField(L, absoluteIndex, 1);
  if (base === undefined) return undefined;
  const variant = readLuaIntegerArrayField(L, absoluteIndex, 2) ?? 0;
  const flags = lua.lua_isnumber(L, flagsIndex) ? lua.lua_tointeger(L, flagsIndex) : 0;
  return base * 0x1000 + variant * 0x10 + flags;
}

function readLuaIntegerArrayField(L: unknown, tableIndex: number, fieldIndex: number): number | undefined {
  lua.lua_rawgeti(L, tableIndex, fieldIndex);
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function getEffectNumberField(field: "typeFlags" | "code" | "description" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    pushLuaEffectValueNumber(state, effect[field] ?? 0);
    return 1;
  };
}

function hasEffectNumberField(field: "typeFlags" | "category" | "property") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = effect[field] ?? 0;
    const actionTypes = 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400;
    const matchesActionGroup = field === "typeFlags" && (requested & 0x8) !== 0 && (value & actionTypes) !== 0;
    const matchesDirectFlags = requested !== 0 && (value & requested) !== 0;
    lua.lua_pushboolean(state, matchesActionGroup || matchesDirectFlags);
    return 1;
  };
}

function setEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef", hostState: LuaHostState) {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    const conditionDescriptor = field === "conditionRef" ? knownLuaEffectConditionDescriptor(state, 2, hostState) : undefined; if (field === "conditionRef" && conditionDescriptor === undefined) delete effect.conditionDescriptor;
    else if (conditionDescriptor !== undefined) effect.conditionDescriptor = conditionDescriptor;
    if (field === "costRef") { const descriptor = knownLuaEffectCostDescriptor(state, 2, hostState); if (descriptor === undefined) delete effect.costDescriptor; else effect.costDescriptor = descriptor; }
    if (field === "targetRef") {
      const descriptor = knownLuaEffectTargetDescriptor(state, 2, hostState);
      if (descriptor === undefined) delete effect.targetDescriptor;
      else effect.targetDescriptor = descriptor;
    }
    lua.lua_pushvalue(state, 2);
    effect[field] = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  };
}

function getEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef" | "operationRef") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    const ref = effect[field];
    if (ref === undefined) lua.lua_pushnil(state);
    else lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, ref);
    return 1;
  };
}

export function toDuelEffect(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, hostState: LuaHostState): DuelEffectDefinition {
  const event = luaEffectEvent(card, luaEffect);
  const range = luaEffect.range ?? luaEffectDefaultRange(card, luaEffect, event);
  const triggerCode = luaEffectTriggerCode(luaEffect);
  const triggerEvent = triggerEventFromCode(triggerCode);
  const value = luaEffectValue(luaEffect) ?? materializedDisableFieldOperationValue(card, luaEffect, L, hostState);
  const duelEffectId = luaEffectDuelId(luaEffect), luaValueDescriptor = luaEffect.valueDescriptor ?? defaultLuaValueDescriptor(luaEffect).luaValueDescriptor, descriptorStatValue = luaValueDescriptorStatValue(luaValueDescriptor, duelEffectId);
  if (!luaEffect.isGlobal) luaEffect.sourceUid = card.uid;
  const duelEffect: DuelEffectDefinition = {
    id: duelEffectId,
    registryKey: luaEffectRegistryKey(card, luaEffect, hostState),
    sourceUid: card.uid,
    controller: luaEffect.ownerPlayer ?? card.controller,
    ...(luaEffect.ownerPlayer === undefined ? {} : { ownerPlayer: luaEffect.ownerPlayer }),
    event,
    luaTypeFlags: luaEffect.typeFlags,
    ...(luaEffect.code === undefined ? {} : { code: luaEffect.code }),
    ...(value === undefined ? {} : { value }),
    ...(luaEffect.conditionDescriptor === undefined ? {} : { luaConditionDescriptor: luaEffect.conditionDescriptor }),
    ...(luaEffect.costDescriptor === undefined ? {} : { luaCostDescriptor: luaEffect.costDescriptor }),
    ...(luaValueDescriptor === undefined ? {} : { luaValueDescriptor }),
    ...(luaEffect.targetDescriptor === undefined ? {} : { luaTargetDescriptor: luaEffect.targetDescriptor }),
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    ...(triggerEvent !== undefined && shouldKeepTriggerCode(triggerEvent, triggerCode) ? { triggerCode } : {}),
    ...(event === "trigger" && luaEffectIsSourceOnlyTrigger(luaEffect.typeFlags, triggerEvent, triggerCode) ? { triggerSourceOnly: true } : {}),
    ...(event === "trigger" ? { optional: luaEffectTriggerIsOptional(luaEffect.typeFlags) } : {}),
    ...(triggerEvent === undefined ? {} : { triggerTiming: luaEffectTriggerTiming(luaEffect) }),
    range,
    oncePerTurn: (luaEffect.countLimit ?? 0) > 0,
    ...(luaEffect.countLimit === undefined ? {} : { countLimit: luaEffect.countLimit }),
    ...(luaEffect.countLimitCode === undefined ? {} : { countLimitCode: luaEffect.countLimitCode }),
    ...(luaEffect.reset === undefined ? {} : { reset: luaEffect.reset }),
    ...(luaEffect.label === undefined ? {} : { label: luaEffect.label }),
    ...(luaEffect.description === undefined ? {} : { description: luaEffect.description }),
    ...(luaEffect.category === undefined ? {} : { category: luaEffect.category }),
    ...(luaEffect.property === undefined ? {} : { property: luaEffect.property }),
    ...(luaEffect.copyId === undefined ? {} : { copyId: luaEffect.copyId }),
    ...(luaEffect.targetRange === undefined ? {} : { targetRange: luaEffect.targetRange }),
    ...(luaEffect.hintTiming === undefined ? {} : { hintTiming: luaEffect.hintTiming }),
    ...(luaEffect.valueRef === undefined ? {} : { battleDamageValue: (ctx, player, amount) => callLuaEffectBattleDamageValue(L, hostState, luaEffect, ctx, player, amount, readLuaError) }),
    ...(luaEffect.valueRef === undefined || luaEffect.code !== 265 ? {} : { forceMonsterZoneValue: (ctx, forcePlayer, reason) => callLuaEffectForceMonsterZoneValue(L, hostState, luaEffect, ctx, forcePlayer, reason, readLuaError) }),
    ...(luaEffect.valueRef === undefined ? {} : { lifePointValue: (ctx, player, amount) => callLuaEffectLifePointValue(L, hostState, luaEffect, ctx, player, amount, readLuaError) }),
    ...(descriptorStatValue === undefined ? luaEffect.valueRef === undefined ? {} : { statValue: (ctx, targetCard) => callLuaEffectStatValue(L, hostState, luaEffect, ctx, targetCard, readLuaError) } : { statValue: descriptorStatValue }),
    ...(luaEffect.valueRef === undefined ? {} : { valueCardPredicate: (ctx, targetCard) => callLuaEffectValueCardPredicate(L, hostState, luaEffect, ctx, targetCard, readLuaError) }),
    ...(luaEffect.valueRef === undefined ? {} : { valuePredicate: (ctx, reasonPlayer) => callLuaEffectValuePredicate(L, hostState, luaEffect, card, ctx, reasonPlayer, readLuaError) }),
    ...(luaEffect.targetRef === undefined ? {} : { targetCardPredicate: (ctx, targetCard) => callLuaEffectCardTargetPredicate(L, hostState, luaEffect, ctx, targetCard) }),
    canActivate: (ctx) => {
      const result =
        (luaEffect.code !== 1027 || hostState.session.state.chain.length > 0) &&
        callLuaEffectBoolean(L, hostState, luaEffect, event === "summonProcedure" && ctx?.source !== undefined ? ctx.source : card, luaEffect.conditionRef, true, "condition", ctx) &&
        (event !== "summonProcedure" || callLuaEffectBoolean(L, hostState, luaEffect, ctx?.source ?? card, luaEffect.valueRef, true, "value", ctx));
      if (result) syncDuelEffectLabelObjectUid(duelEffect, luaEffect);
      else { delete duelEffect.labelObjectUid; delete duelEffect.labelObjectUids; }
      return result;
    },
    cost: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, event === "summonProcedure" && ctx.source !== undefined ? ctx.source : card, luaEffect.costRef, true, "cost", ctx),
    target: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, event === "summonProcedure" && ctx.source !== undefined ? ctx.source : card, luaEffect.targetRef, true, "target", ctx),
    operation: (ctx) => {
      const operationRef = luaEffect.operationRef;
      if (ctx.chainLink?.effectLabel !== undefined) syncDisableFieldLabelObjectValues(hostState, luaEffect.id, ctx.chainLink.effectLabel);
      if (operationRef === undefined) {
        ctx.log("Lua effect resolved without an operation");
        return;
      }
      syncLuaEffectPropertyFromRegisteredDuelEffect(hostState, luaEffect);
      withLuaCallbackContext(hostState, ctx, luaEffect.id, "operation", () => {
        if (ctx.chainLink?.effectLabel !== undefined) luaEffect.label = ctx.chainLink.effectLabel;
        if (ctx.chainLink?.effectLabels !== undefined) luaEffect.labels = [...ctx.chainLink.effectLabels];
        callLuaEffectOperation(L, hostState, luaEffect, event === "summonProcedure" && ctx.source !== undefined ? ctx.source : card, operationRef, ctx, readLuaError);
        if (applyLuaContinuousSetControlEffects(hostState.session, ctx.player, luaEffectReasonPayload(hostState, duelReason.effect, ctx.player))) hostState.activeOperationMoved = true;
        ctx.log("Lua effect operation resolved");
      });
    },
    promptOperation: (ctx) => runLuaEffectOperationPromptCoroutine(L, hostState, luaEffectDuelId(luaEffect), card, ctx),
  };
  return duelEffect;
}

function luaEffectValue(luaEffect: LuaEffectRecord): number | undefined {
  return luaEffect.value ?? (luaEffect.code === luaEffectDisableField ? luaEffect.label : undefined);
}

function materializedDisableFieldOperationValue(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, hostState: LuaHostState): number | undefined {
  if (luaEffect.code !== luaEffectDisableField || luaEffect.value !== undefined || luaEffect.label !== undefined || luaEffect.operationRef === undefined || hostState.activeContext === undefined) return undefined;
  const value = withLuaCallbackContext(hostState, hostState.activeContext, luaEffect.id, "operation", () => callLuaEffectOperationNumber(L, hostState, luaEffect, card, luaEffect.operationRef!, hostState.activeContext!));
  if (value !== undefined) luaEffect.value = value;
  return value;
}

function defaultLuaValueDescriptor(luaEffect: LuaEffectRecord): Pick<DuelEffectDefinition, "luaValueDescriptor"> { return luaEffect.code === 30 && luaEffect.valueRef === undefined && (luaEffect.value === undefined || luaEffect.value === 0) ? { luaValueDescriptor: "special-summon-condition:false" } : {}; }

function luaEffectEvent(card: DuelCardInstance, luaEffect: LuaEffectRecord): DuelEffectDefinition["event"] {
  const { typeFlags, code } = luaEffect;
  const triggerEvent = triggerEventFromCode(luaEffectTriggerCode(luaEffect));
  if (code === luaEffectSpecialSummonProc) return "summonProcedure";
  if (code === 1027 && (typeFlags & 0x800) !== 0) return "continuous";
  if (code === 1027 && ((typeFlags & 0x80) !== 0 || (typeFlags & 0x200) !== 0)) return "trigger";
  if (triggerEvent === "customEvent" && (typeFlags & (0x100 | 0x400)) !== 0 && ((luaEffect.property ?? 0) & 0x10000) !== 0) return "trigger";
  if (code === 1002 && (typeFlags & 0x10) !== 0 && isFastSpellTrapActivation(card)) return "quick";
  if (isSummonAttemptTriggerEvent(triggerEvent) && (typeFlags & 0x10) !== 0 && isFastSpellTrapActivation(card)) return "trigger";
  if (triggerEvent !== undefined && (typeFlags & 0x10) !== 0 && isFastSpellTrapActivation(card)) return "quick";
  if (code === 1027) return "quick";
  if (
    code === 2 ||
    code === 3 ||
    code === 6 ||
    code === 8 ||
    code === 10 ||
    code === 12 ||
    code === 13 ||
    code === 22 ||
    code === 26 ||
    code === 27 ||
    code === 40 ||
    code === 39 ||
    code === 41 ||
    code === 42 ||
    code === 43 ||
    code === 44 ||
    code === 45 ||
    code === 46 ||
    code === 47 ||
    code === 48 ||
    code === 50 ||
    code === 51 ||
    code === 52 ||
    code === 57 ||
    code === 58 ||
    code === 59 ||
    code === 60 ||
    code === 61 ||
    code === 62 ||
    code === 63 ||
    code === 64 ||
    code === 65 ||
    code === 66 ||
    code === 67 ||
    code === 68 ||
    code === 76 ||
    [90, 91, 92, 93, 94, 95].includes(code ?? -1) ||
    code === 313 ||
    code === 85 ||
    code === 235 ||
    code === 236 ||
    code === 238 ||
    code === 239 ||
    code === 241 ||
    code === 248 ||
    code === 333 ||
    code === 400 ||
    code === 401 ||
    code === 402
  )
    return "continuous";
  if ((typeFlags & luaEffectTypeFlip) !== 0 || (typeFlags & 0x80) !== 0 || (typeFlags & 0x200) !== 0) return "trigger";
  if ((typeFlags & 0x100) !== 0 || (typeFlags & 0x400) !== 0) return "quick";
  if ((typeFlags & 0x2) !== 0) return "continuous";
  if ((typeFlags & 0x800) !== 0) return "continuous";
  if ((typeFlags & 0x40) !== 0 || (typeFlags & 0x10) !== 0) return "ignition";
  if ((typeFlags & (0x1 | 0x4 | 0x1000 | 0x2000 | 0x4000)) !== 0) return "continuous";
  return "ignition";
}

function isFastSpellTrapActivation(card: DuelCardInstance): boolean { return card.kind === "trap" || (card.kind === "spell" && ((card.data.typeFlags ?? 0) & 0x10000) !== 0); }

function isSummonAttemptTriggerEvent(event: DuelEffectDefinition["triggerEvent"]): boolean {
  return event === "normalSummoning" || event === "flipSummoning" || event === "specialSummoning";
}

function luaEffectDefaultRange(card: DuelCardInstance, luaEffect: LuaEffectRecord, event: DuelEffectDefinition["event"]): DuelLocation[] {
  if (event === "trigger" && luaEffectIsSourceOnlyTrigger(luaEffect.typeFlags, triggerEventFromCode(luaEffectTriggerCode(luaEffect)), luaEffectTriggerCode(luaEffect))) return [...duelLocations];
  if (event === "continuous" && luaEffectIsSourceOnlyContinuousEvent(luaEffect.typeFlags, triggerEventFromCode(luaEffectTriggerCode(luaEffect)))) return [...duelLocations];
  if (event === "continuous" && (luaEffect.typeFlags & 0x4) !== 0) return ["spellTrapZone"];
  if (event === "continuous" && shouldSurviveLuaSingleEffectEnteringField(card, luaEffect)) return [...duelLocations];
  if (event === "continuous" && luaEffect.code === luaEffectFusionSubstitute) return [...duelLocations];
  if (event === "continuous" && luaEffect.code === 313) return ["monsterZone"];
  if (event === "continuous" || event === "summonProcedure" || event === "trigger") return [card.location];
  if ((luaEffect.typeFlags & 0x10) !== 0 && card.kind === "spell") return ["hand", "spellTrapZone"];
  if ((luaEffect.typeFlags & 0x10) !== 0 && card.kind === "trap") return ["spellTrapZone"];
  if ((luaEffect.typeFlags & 0x10) !== 0 && isPendulumCard(card)) return ["hand", "spellTrapZone"];
  if (card.kind === "spell" || card.kind === "trap") return ["spellTrapZone"];
  return ["monsterZone"];
}

function shouldSurviveLuaSingleEffectEnteringField(card: DuelCardInstance, luaEffect: LuaEffectRecord): boolean {
  const resetFlags = luaEffect.reset?.flags ?? 0;
  return (
    (luaEffect.typeFlags & luaEffectTypeSingle) !== 0 &&
    (resetFlags & luaResetEvent) !== 0 &&
    (resetFlags & luaResetToField) === 0 &&
    card.location !== "monsterZone" &&
    card.location !== "spellTrapZone"
  );
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}

function shouldKeepTriggerCode(triggerEvent: DuelEventName, code: number | undefined): code is number {
  return code !== undefined;
}

function luaEffectIsSourceOnlyTrigger(typeFlags: number, triggerEvent: DuelEventName | undefined, triggerCode: number | undefined): boolean {
  return (
    (typeFlags & 0x1) !== 0 &&
    ((typeFlags & luaEffectTypeFlip) !== 0 || (typeFlags & 0x80) !== 0 || (typeFlags & 0x200) !== 0) &&
    (triggerEvent === "attackDeclared" ||
      triggerEvent === "attackDisabled" ||
      triggerEvent === "banished" ||
      triggerEvent === "battleDamageDealt" ||
      triggerEvent === "battleEnded" ||
      triggerEvent === "battleStarted" ||
      triggerEvent === "becameTarget" ||
      triggerEvent === "beforeDamageCalculation" ||
      triggerEvent === "beforeBattleDamage" ||
      triggerEvent === "battleTargeted" ||
      triggerEvent === "battleConfirmed" ||
      (triggerEvent === "battleDestroyed" && triggerCode === 1140) ||
      triggerEvent === "cardsDrawn" ||
      triggerEvent === "confirmed" ||
      triggerEvent === "controlChanged" ||
      triggerEvent === "counterAdded" ||
      triggerEvent === "counterRemoved" ||
      triggerEvent === "destroyed" ||
      triggerEvent === "destroying" ||
      triggerEvent === "damageCalculating" ||
      triggerEvent === "damageStepEnded" ||
      triggerEvent === "detachedMaterial" ||
      triggerEvent === "discarded" ||
      triggerEvent === "equipped" ||
      triggerEvent === "flipSummoning" ||
      triggerEvent === "flipSummonNegated" ||
      triggerEvent === "flipSummoned" ||
      triggerEvent === "leftField" ||
      triggerEvent === "leftGraveyard" ||
      triggerEvent === "monsterSet" ||
      triggerEvent === "moved" ||
      triggerEvent === "normalSummoning" ||
      triggerEvent === "normalSummonNegated" ||
      triggerEvent === "positionChanged" ||
      triggerEvent === "afterDamageCalculation" ||
      triggerEvent === "preUsedAsMaterial" ||
      triggerEvent === "released" ||
      triggerEvent === "returnedToGraveyard" ||
      triggerEvent === "sentToDeck" ||
      triggerEvent === "sentToGraveyard" ||
      triggerEvent === "sentToHand" ||
      triggerEvent === "sentToHandConfirmed" ||
      triggerEvent === "spellTrapSet" ||
      triggerEvent === "specialSummoning" ||
      triggerEvent === "specialSummonNegated" ||
      triggerEvent === "usedAsMaterial" ||
      triggerEvent === "normalSummoned" ||
      triggerEvent === "specialSummoned")
  );
}

function luaEffectIsSourceOnlyContinuousEvent(typeFlags: number, triggerEvent: DuelEventName | undefined): boolean {
  return (typeFlags & 0x1) !== 0 && (typeFlags & 0x800) !== 0 && triggerEvent !== undefined;
}

function luaEffectTriggerIsOptional(typeFlags: number): boolean {
  if ((typeFlags & luaEffectTypeFlip) !== 0) return false;
  return (typeFlags & 0x200) === 0;
}

function luaEffectTriggerTiming(luaEffect: LuaEffectRecord): "if" | "when" { return (luaEffect.property ?? 0) & 0x10000 ? "if" : "when"; }

function luaEffectTriggerCode(luaEffect: LuaEffectRecord): number | undefined {
  return (luaEffect.typeFlags & luaEffectTypeFlip) !== 0 && luaEffect.code === undefined ? luaEventFlip : luaEffect.code;
}

function pushLuaEffectCallbackArgs(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, kind: LuaEffectCallbackKind, legacyArgs: boolean, ctx?: DuelEffectContext): number {
  const chainLink = luaEffect.code === 1027 ? hostState.session.state.chain[hostState.session.state.chain.length - 1] : undefined;
  const eventGroupUids = ctx?.eventUids ?? (ctx?.eventCard ? [ctx.eventCard.uid] : chainLink ? [chainLink.sourceUid] : []);
  pushLuaEffectTable(L, luaEffect.id, hostState);
  if (legacyArgs) {
    if (luaEffect.code === 90 && kind === "cost") { pushRelatedEffectTable(L, hostState, ctx?.relatedEffectId); lua.lua_pushinteger(L, ctx?.player ?? card.controller); return 3; }
    pushCardTable(L, card.uid);
    if ((luaEffect.code === luaEffectSummonProc || luaEffect.code === luaEffectLimitSummonProc) && kind === "condition") { lua.lua_pushinteger(L, 0); return 3; }
    if ([91, 93, 94, 95, 96].includes(luaEffect.code ?? -1) && kind === "cost") { lua.lua_pushinteger(L, ctx?.player ?? card.controller); return 3; }
    if (luaEffect.code === 92 && kind === "cost") { lua.lua_pushinteger(L, ctx?.player ?? card.controller); lua.lua_pushinteger(L, effectiveSpecialSummonTypeCode(ctx?.summonTypeCode)); return 4; }
    return 2;
  }
  const appendSummonProcedureCard = luaEffect.code === luaEffectSummonProc || luaEffect.code === luaEffectLimitSummonProc || luaEffect.code === luaEffectSpecialSummonProc;
  lua.lua_pushinteger(L, ctx?.player ?? card.controller);
  pushGroupTable(L, eventGroupUids);
  lua.lua_pushinteger(L, chainLink?.eventPlayer ?? chainLink?.player ?? ctx?.eventPlayer ?? ctx?.eventCard?.controller ?? ctx?.player ?? card.controller);
  lua.lua_pushinteger(L, chainLink?.eventValue ?? ctx?.eventValue ?? (chainLink ? hostState.session.state.chain.length : 0));
  pushRelatedEffectTable(
    L,
    hostState,
    firstFiniteNumber(
      chainLink?.relatedEffectId,
      ctx?.chainLink?.relatedEffectId,
      ctx?.relatedEffectId,
      relatedEffectIdFromChainLink(chainLink),
      relatedEffectIdFromEventHistory(hostState, ctx),
    ),
  );
  lua.lua_pushinteger(L, chainLink?.eventReason ?? ctx?.eventReason ?? ctx?.eventCard?.reason ?? 0);
  lua.lua_pushinteger(L, chainLink?.eventReasonPlayer ?? chainLink?.player ?? ctx?.eventReasonPlayer ?? ctx?.eventCard?.reasonPlayer ?? ctx?.eventCard?.controller ?? ctx?.player ?? card.controller);
  if (kind === "cost" || kind === "target") {
    lua.lua_pushinteger(L, ctx?.checkOnly ? 0 : 1);
    if (kind === "target" && appendSummonProcedureCard) {
      pushCardTable(L, card.uid);
      return 10;
    }
    return 9;
  }
  if (kind === "operation" && appendSummonProcedureCard) {
    pushCardTable(L, card.uid);
    return 9;
  }
  return 8;
}

function secondParameterName(L: unknown, functionIndex: number): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, functionIndex);
  lua.lua_getglobal(L, to_luastring("debug"));
  lua.lua_getfield(L, -1, to_luastring("getlocal"));
  lua.lua_pushvalue(L, absoluteIndex);
  lua.lua_pushinteger(L, 2);
  const status = lua.lua_pcall(L, 2, 2, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  const name = lua.lua_isstring(L, -2) ? lua.lua_tojsstring(L, -2) : undefined;
  lua.lua_pop(L, 3);
  return name;
}

function pushRelatedEffectTable(L: unknown, hostState: LuaHostState, relatedEffectId?: number): void {
  if (relatedEffectId !== undefined) {
    pushLuaEffectTable(L, relatedEffectId, hostState);
    return;
  }
  const link = hostState.session.state.chain[hostState.session.state.chain.length - 1];
  const id = Number(link?.effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) pushLuaEffectTable(L, id, hostState);
  else lua.lua_pushnil(L);
}

type LuaEffectCallbackKind = "condition" | "cost" | "target" | "operation" | "value";

export function changeLuaChainOperation(L: unknown, hostState: LuaHostState, chainIndex: number, operationRef: number): boolean {
  const link = chainLinkByLuaIndex(hostState.session, chainIndex);
  const id = Number(link?.effectId.match(/^lua-(\d+)/)?.[1]);
  const luaEffect = Number.isFinite(id) ? hostState.effects.get(id) : undefined;
  const source = link ? hostState.session.state.cards.find((card) => card.uid === link.sourceUid) : undefined;
  if (!link || !luaEffect || !source) return false;
  link.operationOverride = (ctx) => {
    withLuaCallbackContext(hostState, ctx, luaEffect.id, "operation", () => {
      callLuaEffectOperation(L, hostState, luaEffect, source, operationRef, ctx, readLuaError);
      ctx.log("Lua chain operation changed");
    });
  };
  return true;
}

export function runLuaEffectOperationPromptCoroutine(
  L: unknown,
  hostState: LuaHostState,
  effectId: string,
  source: DuelCardInstance,
  ctx: DuelEffectContext,
): LuaPromptCoroutineResult {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  const luaEffect = Number.isFinite(id) ? hostState.effects.get(id) : undefined;
  if (!luaEffect) return { status: "error", error: `Lua effect ${effectId} was not found` };
  const operationRef = luaEffect.operationRef;
  if (operationRef === undefined) return { status: "completed", values: [] };
  if (ctx.chainLink?.effectLabel !== undefined) luaEffect.label = ctx.chainLink.effectLabel;
  if (ctx.chainLink?.effectLabels !== undefined) luaEffect.labels = [...ctx.chainLink.effectLabels];
  const result = withLuaCallbackContext(hostState, ctx, luaEffect.id, "operation", () => callLuaEffectOperationCoroutine(L, hostState, luaEffect, source, operationRef, ctx));
  return wrapLuaEffectOperationCoroutineResult(hostState, luaEffect, ctx, result);
}

function callLuaEffectOperation(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  card: DuelCardInstance,
  operationRef: number,
  ctx: DuelEffectContext,
  readLuaError: (state: unknown) => string,
): void {
  applyLuaEffectContextLabelObject(L, luaEffect, ctx);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, operationRef);
  const legacyArgs = secondParameterName(L, -1) === "c";
  const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, "operation", legacyArgs, ctx);
  const status = lua.lua_pcall(L, argCount, 0, 0);
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}

function callLuaEffectOperationNumber(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  card: DuelCardInstance,
  operationRef: number,
  ctx: DuelEffectContext,
): number | undefined {
  applyLuaEffectContextLabelObject(L, luaEffect, ctx);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, operationRef);
  const legacyArgs = secondParameterName(L, -1) === "c";
  const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, "operation", legacyArgs, ctx);
  const status = lua.lua_pcall(L, argCount, 1, 0);
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
  const value = lua.lua_isnumber(L, -1) ? readLuaEffectValueNumber(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function callLuaEffectOperationCoroutine(
  L: unknown,
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  card: DuelCardInstance,
  operationRef: number,
  ctx: DuelEffectContext,
): LuaPromptCoroutineResult {
  applyLuaEffectContextLabelObject(L, luaEffect, ctx);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, operationRef);
  const legacyArgs = secondParameterName(L, -1) === "c";
  const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, "operation", legacyArgs, ctx);
  const result = runLuaPromptCoroutineFromStack(L, hostState, argCount);
  return result;
}

function wrapLuaEffectOperationCoroutineResult(
  hostState: LuaHostState,
  luaEffect: LuaEffectRecord,
  ctx: DuelEffectContext,
  result: LuaPromptCoroutineResult,
): LuaPromptCoroutineResult {
  if (result.status === "completed") {
    ctx.log("Lua effect operation resolved");
    return result;
  }
  if (result.status !== "yielded") return result;
  return {
    ...result,
    resume(value) {
      const resumed = withLuaCallbackContext(hostState, ctx, luaEffect.id, "operation", () => result.resume(value));
      return wrapLuaEffectOperationCoroutineResult(hostState, luaEffect, ctx, resumed);
    },
  };
}

function chainLinkByLuaIndex(session: DuelSession, requestedIndex: number): DuelSession["state"]["chain"][number] | undefined {
  if (requestedIndex <= 0) return session.state.chain[session.state.chain.length - 1];
  return session.state.chain[requestedIndex - 1];
}

function callLuaEffectBoolean(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, ref: number | undefined, fallback: boolean, kind: LuaEffectCallbackKind, ctx?: DuelEffectContext): boolean {
  if (ref === undefined) return fallback;
  syncLuaEffectPropertyFromRegisteredDuelEffect(hostState, luaEffect);
  return withLuaCallbackContext(hostState, ctx, luaEffect.id, kind, () => {
    applyLuaEffectContextLabelObject(L, luaEffect, ctx);
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    const legacyArgs = secondParameterName(L, -1) === "c";
    if (legacyArgs && ctx?.checkOnly && (kind === "cost" || kind === "target") && ![90, 91, 92, 93, 94, 95, 96].includes(luaEffect.code ?? -1)) {
      lua.lua_pop(L, 1);
      return fallback;
    }
    const argCount = pushLuaEffectCallbackArgs(L, hostState, luaEffect, card, kind, legacyArgs, ctx);
    const status = lua.lua_pcall(L, argCount, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    if (kind === "cost" && !ctx?.checkOnly) {
      lua.lua_pop(L, 1);
      return true;
    }
    const result = lua.lua_isnil(L, -1) ? fallback : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

function callLuaEffectCardTargetPredicate(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, ctx: DuelEffectContext, card: DuelCardInstance): boolean {
  if (luaEffect.targetRef === undefined) return true;
  syncLuaEffectPropertyFromRegisteredDuelEffect(hostState, luaEffect);
  return withLuaCallbackContext(hostState, ctx, luaEffect.id, "target", () => {
    applyLuaEffectContextLabelObject(L, luaEffect, ctx);
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.targetRef);
    pushLuaEffectTable(L, luaEffect.id, hostState);
    if (luaEffect.code === 90) { pushRelatedEffectTable(L, hostState, ctx.relatedEffectId); lua.lua_pushinteger(L, ctx.player ?? card.controller); } else pushCardTable(L, card.uid);
    if (luaEffect.code === 22) { lua.lua_pushinteger(L, ctx.eventPlayer ?? card.controller); lua.lua_pushinteger(L, effectiveSpecialSummonTypeCode(ctx.summonTypeCode)); lua.lua_pushinteger(L, positionMaskFromPosition(ctx.summonPosition)); lua.lua_pushinteger(L, ctx.eventPlayer ?? card.controller); pushRelatedEffectTable(L, hostState, ctx.relatedEffectId); pushRelatedEffectTable(L, hostState, ctx.relatedEffectId); }
    const status = lua.lua_pcall(L, luaEffect.code === 22 ? 8 : luaEffect.code === 90 ? 3 : 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_toboolean(L, -1); lua.lua_pop(L, 1); return Boolean(result);
  });
}

function applyLuaEffectContextLabelObject(L: unknown, luaEffect: LuaEffectRecord, ctx: DuelEffectContext | undefined): void {
  if (ctx?.effectLabelObjectUid === undefined && ctx?.effectLabelObjectUids === undefined) return;
  if (luaEffect.labelObjectRef !== undefined && ctx.effectLabelObjectUid !== undefined && luaEffect.labelObjectUid === ctx.effectLabelObjectUid) return;
  if (luaEffect.labelObjectRef !== undefined && ctx.effectLabelObjectUids !== undefined && sameUids(luaEffect.labelObjectUids, ctx.effectLabelObjectUids)) return;
  if (luaEffect.labelObjectRef !== undefined) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, luaEffect.labelObjectRef);
  delete luaEffect.labelObjectId; delete luaEffect.labelObjectUid; delete luaEffect.labelObjectUids;
  if (ctx.effectLabelObjectUid !== undefined) {
    luaEffect.labelObjectUid = ctx.effectLabelObjectUid; pushCardTable(L, ctx.effectLabelObjectUid);
  } else {
    luaEffect.labelObjectUids = [...(ctx.effectLabelObjectUids ?? [])]; pushGroupTable(L, luaEffect.labelObjectUids);
  }
  luaEffect.labelObjectRef = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
}

function syncActiveLabelObject(hostState: LuaHostState, effect: LuaEffectRecord, uid?: string, uids?: string[]): void {
  if (hostState.activeLuaEffectId !== effect.id || !hostState.activeContext) return;
  const ctx = hostState.activeContext;
  if (uid === undefined && uids === undefined) {
    delete ctx.effectLabelObjectUid; delete ctx.effectLabelObjectUids;
    if (ctx.chainLink) { delete ctx.chainLink.effectLabelObjectUid; delete ctx.chainLink.effectLabelObjectUids; }
    return;
  }
  if (uid !== undefined) ctx.effectLabelObjectUid = uid; else delete ctx.effectLabelObjectUid;
  if (uids !== undefined) ctx.effectLabelObjectUids = [...uids]; else delete ctx.effectLabelObjectUids;
  if (ctx.chainLink) {
    if (uid !== undefined) ctx.chainLink.effectLabelObjectUid = uid; else delete ctx.chainLink.effectLabelObjectUid;
    if (uids !== undefined) ctx.chainLink.effectLabelObjectUids = [...uids]; else delete ctx.chainLink.effectLabelObjectUids;
  }
}

function syncActiveLabels(hostState: LuaHostState, label: number, labels: number[]): void {
  const ctx = hostState.activeContext;
  if (!ctx) return;
  ctx.effectLabel = label;
  if (labels.length > 1) ctx.effectLabels = labels; else delete ctx.effectLabels;
  if (ctx.chainLink) {
    ctx.chainLink.effectLabel = label;
    if (labels.length > 1) ctx.chainLink.effectLabels = [...labels]; else delete ctx.chainLink.effectLabels;
  }
  syncDisableFieldLabelObjectValues(hostState, hostState.activeLuaEffectId, label);
}

function syncDisableFieldLabelObjectValues(hostState: LuaHostState, labelObjectId: number | undefined, value: number): void {
  if (labelObjectId === undefined) return;
  for (const luaEffect of hostState.effects.values()) {
    if (luaEffect.code !== luaEffectDisableField || luaEffect.labelObjectId !== labelObjectId) continue;
    luaEffect.value = value;
    for (const effect of registeredDuelEffectsForLuaEffect(hostState, luaEffect)) effect.value = value;
  }
}

function syncDuelEffectLabelObjectUid(effect: DuelEffectDefinition, luaEffect: LuaEffectRecord): void { if (luaEffect.labelObjectUid === undefined) delete effect.labelObjectUid; else effect.labelObjectUid = luaEffect.labelObjectUid; if (luaEffect.labelObjectUids === undefined) delete effect.labelObjectUids; else effect.labelObjectUids = [...luaEffect.labelObjectUids]; }

function syncRegisteredDuelEffectLabelObject(hostState: LuaHostState, luaEffect: LuaEffectRecord): void { for (const effect of registeredDuelEffectsForLuaEffect(hostState, luaEffect)) syncDuelEffectLabelObjectUid(effect, luaEffect); }

function syncRegisteredDuelEffectProperty(hostState: LuaHostState, luaEffect: LuaEffectRecord): void { for (const effect of registeredDuelEffectsForLuaEffect(hostState, luaEffect)) if (luaEffect.property === undefined) delete effect.property; else effect.property = luaEffect.property; }

function syncLuaEffectPropertyFromRegisteredDuelEffect(hostState: LuaHostState, luaEffect: LuaEffectRecord): void { const effect = registeredDuelEffectsForLuaEffect(hostState, luaEffect)[0]; if (!effect) return; if (effect.property === undefined) delete luaEffect.property; else luaEffect.property = effect.property; }

function registeredDuelEffectsForLuaEffect(hostState: LuaHostState, luaEffect: LuaEffectRecord): DuelEffectDefinition[] { const duelEffectId = luaEffectDuelId(luaEffect); return hostState.session.state.effects.filter((effect) => effect.id === duelEffectId && (luaEffect.sourceUid === undefined || effect.sourceUid === luaEffect.sourceUid)); }

function sameUids(left: string[] | undefined, right: string[]): boolean { return left?.length === right.length && left.every((uid, index) => uid === right[index]); }

function withLuaCallbackContext<T>(hostState: LuaHostState, ctx: DuelEffectContext | undefined, luaEffectId: number | undefined, kind: LuaEffectCallbackKind, callback: () => T): T {
  const previousTargets = hostState.activeTargetUids;
  const previousLuaEffectId = hostState.activeLuaEffectId;
  const previousContext = hostState.activeContext;
  const previousTriggerStart = hostState.activeOperationTriggerStart;
  const previousOperationMoved = hostState.activeOperationMoved;
  const previousOperatedUids = [...hostState.operatedUids];
  const previousSummonNegatedUids = [...hostState.summonNegatedUids];
  const operationTriggerStart = ctx ? luaOperationTriggerStart(hostState, ctx, kind) : previousTriggerStart;
  hostState.activeTargetUids = ctx?.targetUids;
  hostState.activeLuaEffectId = luaEffectId;
  hostState.activeContext = ctx;
  hostState.activeOperationTriggerStart = operationTriggerStart;
  hostState.activeOperationMoved = kind === "operation" && operationTriggerStart !== undefined && operationTriggerStart < hostState.session.state.pendingTriggers.length;
  if (ctx?.eventUids) hostState.operatedUids.splice(0, hostState.operatedUids.length, ...ctx.eventUids);
  try {
    return callback();
  } finally {
    hostState.activeTargetUids = previousTargets;
    hostState.activeLuaEffectId = previousLuaEffectId;
    hostState.activeContext = previousContext;
    hostState.activeOperationTriggerStart = previousTriggerStart;
    hostState.activeOperationMoved = previousOperationMoved;
    if (ctx?.eventUids) hostState.operatedUids.splice(0, hostState.operatedUids.length, ...previousOperatedUids);
    hostState.summonNegatedUids.splice(0, hostState.summonNegatedUids.length, ...previousSummonNegatedUids);
  }
}

function luaOperationTriggerStart(hostState: LuaHostState, ctx: DuelEffectContext, kind: LuaEffectCallbackKind): number {
  if (kind !== "operation" || ctx.chainLink?.id === undefined) return hostState.session.state.pendingTriggers.length;
  const index = hostState.session.state.pendingTriggers.findIndex((trigger) => trigger.eventName === "becameTarget" && trigger.eventChainLinkId === ctx.chainLink?.id);
  return index < 0 ? hostState.session.state.pendingTriggers.length : index;
}
