import fengari from "fengari";
import { findCard, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { recordDuelEvent } from "#duel/event-history.js";
import { installAuxApi, installConstants, installDebugApi } from "#lua/basic-api.js";
import { installCardApi } from "#lua/card-api.js";
import { installCardProcedureApi } from "#lua/card-procedure-api.js";
import { installDuelApi } from "#lua/duel-api/index.js";
import { installGroupApi } from "#lua/group-api.js";
import { scriptFilenameForCard } from "#engine/data-loaders.js";
import { installTypeCompatibilityApi } from "#lua/type-compatibility-api.js";
import { installTracebackHandler, loadLuaScriptFile, readLuaError, registerLuaInitialEffectsDetailed, runLuaCardScript } from "#lua/host-script-api.js";
import { installEffectApi, installGetIdCompatibilityApi, pushLuaEffectTable, majesticCopyLuaEffects, changeLuaChainOperation, registerLuaEffect, toDuelEffect } from "#lua/host-effect-api.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaHostState, LuaScriptHost, LuaScriptSource } from "#lua/host-types.js";

const { lua, lauxlib, lualib, to_luastring } = fengari;

export type { LuaInitialEffectRegistrationResult, LuaScriptHost, LuaScriptLoadResult, LuaScriptSource } from "#lua/host-types.js";

export function createLuaScriptHost(session: DuelSession, scriptSource?: LuaScriptSource): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = {
    session,
    nextEffectId: 1,
    effects: new Map(),
    usedEffectCounts: new Map(),
    messages: [],
    activeTargetUids: undefined,
    activeLuaEffectId: undefined,
    activeContext: undefined,
    activeOperationTriggerStart: undefined,
    activeOperationMoved: false,
    operationInfos: [],
    possibleOperationInfos: [],
    operatedUids: [],
    selectedUids: [],
    fusionMaterialUids: [],
    scriptSource,
    loadedScripts: new Set(),
    currentScriptCardCode: undefined,
    pushEffectTable(state, id) {
      pushLuaEffectTable(state, id, hostState);
    },
    getEffectTypeFlags(id) {
      return hostState.effects.get(id)?.typeFlags;
    },
    majesticCopy(state, receiverUid, sourceUid, reset) {
      return majesticCopyLuaEffects(state, hostState, receiverUid, sourceUid, reset);
    },
    changeChainOperation(state, chainIndex, operationRef) {
      return changeLuaChainOperation(state, hostState, chainIndex, operationRef);
    },
    registerEffect(state, id, player) {
      return registerLuaEffect(state, hostState, id, player);
    },
    loadScriptFile(name, forced = false) {
      return loadLuaScriptFile(L, hostState, name, forced);
    },
  };
  lualib.luaL_openlibs(L);
  installTracebackHandler(L);
  installTypeCompatibilityApi(L);
  installConstants(L);
  installDebugApi(L, hostState.messages);
  installAuxApi(L, readLuaError, session);
  installDuelApi(L, session, hostState);
  installEffectApi(L, hostState, readLuaError);
  installCardApi(L, session, hostState, (card, luaEffect, state) => toDuelEffect(card, luaEffect, state, hostState));
  installCardProcedureApi(L, readLuaError);
  installGroupApi(L, hostState, session);
  installGetIdCompatibilityApi(L, hostState);

  return {
    messages: hostState.messages,
    loadScript(code, name) {
      return runLuaCardScript(L, hostState, code, name);
    },
    loadCardScript(cardCode, source) {
      const name = scriptFilenameForCard(cardCode);
      const code = source.readScript(name);
      if (code === undefined) return { ok: false, name, error: `Script ${name} was not found` };
      return runLuaCardScript(L, hostState, code, name);
    },
    registerInitialEffects() {
      let count = 0;
      for (const result of registerLuaInitialEffectsDetailed(L, session)) {
        if (result.error) throw new Error(result.error);
        if (!result.skipped) count += 1;
      }
      return count;
    },
    registerInitialEffectsDetailed() {
      return registerLuaInitialEffectsDetailed(L, session);
    },
    runStartupEffects() {
      return runLuaStartupEffects(session);
    },
    getGlobalString(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
    getGlobalNumber(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
  };
}

function runLuaStartupEffects(session: DuelSession): number {
  let count = 0;
  recordDuelEvent(session.state, "startup", undefined, 1000);
  for (const effect of [...session.state.effects]) {
    if (effect.code !== 1000 || !canUseEffectCount(session.state, effect)) continue;
    const source = findCard(session.state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createStartupEffectContext(session, effect, source);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    effect.operation(ctx);
    markEffectUsed(session.state, effect);
    count += 1;
  }
  return count;
}

function createStartupEffectContext(session: DuelSession, effect: DuelEffectDefinition, source: DuelCardInstance) {
  const player = effect.controller;
  return {
    duel: session.state,
    source,
    player,
    eventName: "startup" as const,
    targetUids: [],
    log(detail: string) {
      pushDuelLog(session.state, "effect", player, source.name, detail);
    },
    moveCard(uid: string, to: Parameters<typeof moveDuelCard>[2], controller?: PlayerId) {
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
  };
}
