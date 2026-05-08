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
import type { ChainLimit, DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "#duel/types.js";
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
    loadedScriptBodies: new Map(),
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
      hostState.loadedScriptBodies.set(name, code);
      return runLuaCardScript(L, hostState, code, name);
    },
    loadCardScript(cardCode, source) {
      const name = scriptFilenameForCard(cardCode);
      const code = source.readScript(name);
      if (code === undefined) return { ok: false, name, error: `Script ${name} was not found` };
      hostState.loadedScriptBodies.set(name, code);
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
    restoreChainLimit(key, limit) {
      return restoreKnownLuaChainLimit(L, hostState, key, limit);
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

function restoreKnownLuaChainLimit(L: unknown, hostState: LuaHostState, key: string, limit: ChainLimit): ChainLimit | undefined {
  const parts = key.split(":");
  const predicate = parts[4] === "known" ? parts.slice(5).join(":") : undefined;
  if (predicate === "aux.FALSE") return { ...limit, allows: () => false };
  if (predicate === "aux.TRUE") return { ...limit, allows: () => true };
  const allowedCard = predicate?.match(/^closure:card-handler:(.+)$/);
  if (allowedCard?.[1]) return { ...limit, allows: (effect) => effect.sourceUid === allowedCard[1] };
  const capturedCard = predicate?.match(/^closure:card-not-handler:(.+)$/);
  if (capturedCard?.[1]) return { ...limit, allows: (effect) => effect.sourceUid !== capturedCard[1] };
  const capturedCards = predicate?.match(/^closure:cards-not-handler:(.+)$/);
  if (capturedCards?.[1]) {
    const blockedUids = new Set(capturedCards[1].split(",").map(decodeURIComponent).filter(Boolean));
    return { ...limit, allows: (effect) => !blockedUids.has(effect.sourceUid) };
  }
  const targetCards = predicate?.match(/^closure:target-cards-not-handler:(.+)$/);
  if (targetCards?.[1]) {
    const blockedUids = new Set(targetCards[1].split(",").map(decodeURIComponent).filter(Boolean));
    return { ...limit, allows: (effect) => !blockedUids.has(effect.sourceUid) };
  }
  const typeMask = predicate?.match(/^closure:type-mask-response-player:(\d+)$/);
  if (typeMask?.[1]) return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (sourceTypeFlags(hostState, effect.sourceUid) & Number(typeMask[1])) === 0 };
  const handlerCode = predicate?.match(/^closure:handler-code:(\d+)$/);
  if (handlerCode?.[1]) return { ...limit, allows: (effect) => sourceCode(hostState, effect.sourceUid) === handlerCode[1] };
  const handlerCodes = predicate?.match(/^closure:handler-codes:([\d,]+)$/);
  if (handlerCodes?.[1]) {
    const codes = new Set(handlerCodes[1].split(",").filter(Boolean));
    return { ...limit, allows: (effect) => {
      const code = sourceCode(hostState, effect.sourceUid);
      return code !== undefined && codes.has(code);
    } };
  }
  const blockedEffectType = predicate?.match(/^closure:not-effect-type:(\d+)$/);
  if (blockedEffectType?.[1]) return { ...limit, allows: (effect) => (effectTypeFlags(hostState, effect.id) & Number(blockedEffectType[1])) === 0 };
  const blockedEffectTypeForOpponent = predicate?.match(/^closure:not-effect-type-response-player:(\d+)$/);
  if (blockedEffectTypeForOpponent?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (effectTypeFlags(hostState, effect.id) & Number(blockedEffectTypeForOpponent[1])) === 0 };
  }
  if (predicate === "closure:not-active-monster-link") {
    return { ...limit, allows: (effect) => (sourceTypeFlags(hostState, effect.sourceUid) & 0x4000001) !== 0x4000001 };
  }
  const blockedActiveTypeForOpponent = predicate?.match(/^closure:not-active-type-response-player:(\d+)$/);
  if (blockedActiveTypeForOpponent?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (sourceTypeFlags(hostState, effect.sourceUid) & Number(blockedActiveTypeForOpponent[1])) === 0 };
  }
  const blockedActiveType = predicate?.match(/^closure:not-active-type:(\d+)$/);
  if (blockedActiveType?.[1]) return { ...limit, allows: (effect) => (sourceTypeFlags(hostState, effect.sourceUid) & Number(blockedActiveType[1])) === 0 };
  const responsePlayer = predicate?.match(/^closure:response-player:([01])$/);
  if (responsePlayer?.[1]) return { ...limit, allows: (_effect, player) => player === Number(responsePlayer[1]) };
  if (predicate === "closure:response-matches-chain-player") return { ...limit, allows: (_effect, player, activeChainPlayer) => player === activeChainPlayer };
  const chainPlayer = predicate?.match(/^closure:chain-player:([01])$/);
  if (chainPlayer?.[1]) return { ...limit, allows: (_effect, _player, activeChainPlayer) => activeChainPlayer === Number(chainPlayer[1]) };
  const field = predicate?.match(/^(c\d+)\.([A-Za-z_]\w*)$/);
  if (!field) return undefined;
  const [, tableName, fieldName] = field;
  if (!tableName || !fieldName) return undefined;
  return {
    ...limit,
    allows(effect, player, chainPlayer) {
      lua.lua_getglobal(L, to_luastring(tableName));
      lua.lua_getfield(L, -1, to_luastring(fieldName));
      if (!lua.lua_isfunction(L, -1)) {
        lua.lua_pop(L, 2);
        return false;
      }
      pushLuaChainLimitEffect(L, hostState, effect.id);
      lua.lua_pushinteger(L, player);
      lua.lua_pushinteger(L, chainPlayer);
      const status = lua.lua_pcall(L, 3, 1, 0);
      if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
      const result = lua.lua_toboolean(L, -1);
      lua.lua_pop(L, 2);
      return Boolean(result);
    },
  };
}

function sourceTypeFlags(hostState: LuaHostState, sourceUid: string): number {
  return hostState.session.state.cards.find((card) => card.uid === sourceUid)?.data.typeFlags ?? 0;
}

function sourceCode(hostState: LuaHostState, sourceUid: string): string | undefined {
  return hostState.session.state.cards.find((card) => card.uid === sourceUid)?.code;
}

function effectTypeFlags(hostState: LuaHostState, effectId: string): number {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? hostState.effects.get(id)?.typeFlags ?? 0 : 0;
}

function pushLuaChainLimitEffect(L: unknown, hostState: LuaHostState, effectId: string): void {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) pushLuaEffectTable(L, id, hostState);
  else lua.lua_pushnil(L);
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
