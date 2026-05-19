import fengari from "fengari";
import { findCard, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { recordDuelEvent } from "#duel/event-history.js";
import { createEffectContext } from "#duel/effect-context.js";
import { installAuxApi, installBitApi, installConstants, installDebugApi } from "#lua/basic-api.js";
import { installCardApi } from "#lua/card-api.js";
import { isSetcodeMatch } from "#lua/card-code-utils.js";
import { installCardProcedureApi } from "#lua/card-procedure-api.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import { installDuelApi } from "#lua/duel-api/index.js";
import { installGroupApi } from "#lua/group-api.js";
import { restorableStatelessLuaChainLimitSource } from "#lua/chain-limit-predicate-descriptors.js";
import { scriptFilenameForCard } from "#engine/data-loaders.js";
import { installTypeCompatibilityApi } from "#lua/type-compatibility-api.js";
import { installTracebackHandler, loadLuaScriptFile, readLuaError, registerLuaInitialEffectsDetailed, runLuaCardScript, runLuaPromptCoroutine, runLuaPromptCoroutineFromStack } from "#lua/host-script-api.js";
import { installEffectApi, installGetIdCompatibilityApi, pushLuaEffectTable, majesticCopyLuaEffects, changeLuaChainOperation, registerLuaEffect, runLuaEffectOperationPromptCoroutine, toDuelEffect } from "#lua/host-effect-api.js";
import { normalizeLuaUnsignedInteger } from "#lua/numeric-utils.js";
import type { ChainLimit, DuelCardInstance, DuelEffectDefinition, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaHostState, LuaScriptHost, LuaScriptHostOptions, LuaScriptLoadResult, LuaScriptSource } from "#lua/host-types.js";

const { lua, lauxlib, lualib, to_luastring } = fengari;

export type { LuaInitialEffectRegistrationResult, LuaScriptHost, LuaScriptLoadResult, LuaScriptSource } from "#lua/host-types.js";

export function createLuaScriptHost(session: DuelSession, scriptSource?: LuaScriptSource, options: LuaScriptHostOptions = {}): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = {
    session,
    nextEffectId: nextLuaEffectId(session),
    nextCopyId: 1,
    effects: new Map(),
    functionDescriptors: new Map(),
    usedEffectCounts: new Map(),
    messages: [],
    promptDecisions: [],
    promptOverrides: options.promptOverrides?.map((override) => ({ ...override })) ?? [],
    nextPromptId: 1,
    promptBehavior: "default",
    activeTargetUids: undefined,
    activeLuaEffectId: undefined,
    activeContext: undefined,
    activeOperationTriggerStart: undefined,
    activeOperationMoved: false,
    pendingSetLpDefeat: false,
    operationInfos: [],
    possibleOperationInfos: [],
    operatedUids: [],
    summonNegatedUids: [],
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
  installBitApi(L);
  installDebugApi(L, hostState.messages);
  installAuxApi(L, readLuaError, session, hostState);
  installDuelApi(L, session, hostState);
  installEffectApi(L, hostState, readLuaError);
  installCardApi(L, session, hostState, (card, luaEffect, state) => toDuelEffect(card, luaEffect, state, hostState));
  installCardProcedureApi(L, readLuaError);
  installGroupApi(L, hostState, session);
  installGetIdCompatibilityApi(L, hostState);

  function loadOptionalCommonScript(source: LuaScriptSource, name: string): LuaScriptLoadResult {
    if (hostState.loadedScriptBodies.has(name)) return { ok: true, name };
    const code = source.readScript(name);
    if (code === undefined) return { ok: true, name };
    hostState.loadedScriptBodies.set(name, code);
    return runLuaCardScript(L, hostState, code, name);
  }

  return {
    messages: hostState.messages,
    promptDecisions: hostState.promptDecisions,
    loadScript(code, name) {
      hostState.loadedScriptBodies.set(name, code);
      return runLuaCardScript(L, hostState, code, name);
    },
    loadCardScript(cardCode, source) {
      const common = loadOptionalCommonScript(source, "cards_specific_functions.lua");
      if (!common.ok) return common;
      const name = scriptFilenameForCard(cardCode);
      const code = source.readScript(name);
      if (code === undefined) {
        const alias = session.state.cards.find((card) => card.code === String(cardCode))?.data.alias;
        if (!alias) return { ok: false, name, error: `Script ${name} was not found` };
        const aliasName = scriptFilenameForCard(alias);
        const aliasCode = source.readScript(aliasName);
        if (aliasCode === undefined) return { ok: false, name, error: `Script ${name} was not found` };
        const result = runLuaCardScript(L, hostState, `Duel.LoadCardScriptAlias(${alias})`, name);
        if (result.ok) hostState.loadedScriptBodies.set(name, aliasCode);
        return result;
      }
      hostState.loadedScriptBodies.set(name, code);
      return runLuaCardScript(L, hostState, code, name);
    },
    registerInitialEffects() {
      let count = 0;
      for (const result of registerLuaInitialEffectsDetailed(L, session, hostState.loadedScriptBodies)) {
        if (result.error) throw new Error(result.error);
        if (!result.skipped) count += 1;
      }
      return count;
    },
    registerInitialEffectsDetailed() {
      return registerLuaInitialEffectsDetailed(L, session, hostState.loadedScriptBodies);
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
      return value !== undefined && Number.isInteger(value) && value < 0 ? normalizeLuaUnsignedInteger(value) : value;
    },
    runPromptCoroutine(code, name) {
      return runLuaPromptCoroutine(L, hostState, code, name);
    },
    runPromptCallback(name, args = []) {
      lua.lua_getglobal(L, to_luastring(name));
      if (!lua.lua_isfunction(L, -1)) {
        lua.lua_pop(L, 1);
        return { status: "error", error: `Lua prompt callback ${name} was not found` };
      }
      for (const arg of args) pushLuaPromptCallbackArg(L, arg);
      return runLuaPromptCoroutineFromStack(L, hostState, args.length);
    },
    runPromptEffectOperation(effectId, sourceUid, player) {
      const source = findCard(session.state, sourceUid);
      if (!source) return { status: "error", error: `Lua effect source ${sourceUid} was not found` };
      const ctx = createEffectContext(session.state, source, player, undefined, undefined, [], false, source.location, source.sequence);
      return runLuaEffectOperationPromptCoroutine(L, hostState, effectId, source, ctx);
    },
  };
}

function pushLuaPromptCallbackArg(L: unknown, arg: number | boolean | string): void {
  if (typeof arg === "boolean") lua.lua_pushboolean(L, arg);
  else if (typeof arg === "number") lua.lua_pushinteger(L, arg);
  else lua.lua_pushstring(L, to_luastring(arg));
}

function nextLuaEffectId(session: DuelSession): number {
  return Math.max(0, ...session.state.effects.map((effect) => Number(effect.id.match(/^lua-(\d+)/)?.[1]) || 0)) + 1;
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
  const capturedCardForOpponent = predicate?.match(/^closure:card-not-handler-response-player:(.+)$/);
  if (capturedCardForOpponent?.[1]) return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || effect.sourceUid !== capturedCardForOpponent[1] };
  const capturedCardsForOpponent = predicate?.match(/^closure:cards-not-handler-response-player:(.+)$/);
  if (capturedCardsForOpponent?.[1]) {
    const blockedUids = new Set(capturedCardsForOpponent[1].split(",").map(decodeURIComponent).filter(Boolean));
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || !blockedUids.has(effect.sourceUid) };
  }
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
  const targetCardsForOpponent = predicate?.match(/^closure:target-cards-not-handler-response-player:(.+)$/);
  if (targetCardsForOpponent?.[1]) {
    const blockedUids = new Set(targetCardsForOpponent[1].split(",").map(decodeURIComponent).filter(Boolean));
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || !blockedUids.has(effect.sourceUid) };
  }
  const originalTypeMask = predicate?.match(/^closure:original-type-mask-response-player:(\d+)$/);
  if (originalTypeMask?.[1]) return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (sourcePrintedTypeFlags(hostState, effect.sourceUid) & Number(originalTypeMask[1])) === 0 };
  const typeMask = predicate?.match(/^closure:type-mask-response-player:(\d+)$/);
  if (typeMask?.[1]) return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (sourceTypeFlags(hostState, effect.sourceUid) & Number(typeMask[1])) === 0 };
  const sourceTypeUnlessChainPlayer = predicate?.match(/^closure:not-source-type-unless-chain-player:(\d+):([01])$/);
  if (sourceTypeUnlessChainPlayer?.[1] && sourceTypeUnlessChainPlayer[2]) {
    return { ...limit, allows: (effect, _player, chainPlayer) => chainPlayer === Number(sourceTypeUnlessChainPlayer[2]) || (sourceTypeFlags(hostState, effect.sourceUid) & Number(sourceTypeUnlessChainPlayer[1])) === 0 };
  }
  const sourceEffectTypeSetcode = predicate?.match(/^closure:not-source-type-effect-type-setcode:(\d+):(\d+):(\d+)$/);
  if (sourceEffectTypeSetcode?.[1] && sourceEffectTypeSetcode[2] && sourceEffectTypeSetcode[3]) {
    return { ...limit, allows: (effect) => (sourceTypeFlags(hostState, effect.sourceUid) & Number(sourceEffectTypeSetcode[1])) === 0 || (effectTypeFlags(hostState, effect.id) & Number(sourceEffectTypeSetcode[2])) === 0 || !sourceHasSetcode(hostState, effect.sourceUid, Number(sourceEffectTypeSetcode[3])) };
  }
  const sourceEffectType = predicate?.match(/^closure:not-source-type-effect-type:(\d+):(\d+)$/);
  if (sourceEffectType?.[1] && sourceEffectType[2]) {
    return { ...limit, allows: (effect) => (sourceTypeFlags(hostState, effect.sourceUid) & Number(sourceEffectType[1])) === 0 || (effectTypeFlags(hostState, effect.id) & Number(sourceEffectType[2])) === 0 };
  }
  const activeEffectType = predicate?.match(/^closure:not-active-type-effect-type:(\d+):(\d+)$/);
  if (activeEffectType?.[1] && activeEffectType[2]) {
    return { ...limit, allows: (effect) => (activeTypeFlags(hostState, effect.sourceUid) & Number(activeEffectType[1])) === 0 || (effectTypeFlags(hostState, effect.id) & Number(activeEffectType[2])) === 0 };
  }
  const counterActivationOrHandlerCode = predicate?.match(/^closure:counter-activate-or-handler-code:(\d+)$/);
  if (counterActivationOrHandlerCode?.[1]) return { ...limit, allows: (effect) => ((sourceTypeFlags(hostState, effect.sourceUid) & 0x100000) !== 0 && (effectTypeFlags(hostState, effect.id) & 0x10) !== 0) || sourceCode(hostState, effect.sourceUid) === counterActivationOrHandlerCode[1] };
  if (predicate === "closure:not-opponent-controlled-trap") return { ...limit, allows: (effect, player) => (sourceTypeFlags(hostState, effect.sourceUid) & 0x4) === 0 || sourceController(hostState, effect.sourceUid) !== (1 - player) };
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
  const responsePlayerHandlerCode = predicate?.match(/^closure:handler-code-response-player:(\d+)$/);
  if (responsePlayerHandlerCode?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || sourceCode(hostState, effect.sourceUid) === responsePlayerHandlerCode[1] };
  }
  const responsePlayerHandlerCodes = predicate?.match(/^closure:handler-codes-response-player:([\d,]+)$/);
  if (responsePlayerHandlerCodes?.[1]) {
    const codes = new Set(responsePlayerHandlerCodes[1].split(",").filter(Boolean));
    return { ...limit, allows: (effect, player, chainPlayer) => {
      const code = sourceCode(hostState, effect.sourceUid);
      return player === chainPlayer || (code !== undefined && codes.has(code));
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
  if (predicate === "closure:not-monster-without-level") {
    return { ...limit, allows: (effect) => (sourceTypeFlags(hostState, effect.sourceUid) & 0x1) === 0 || sourceHasLevel(hostState, effect.sourceUid) };
  }
  const blockedActiveTypeForOpponent = predicate?.match(/^closure:not-active-type-response-player:(\d+)$/);
  if (blockedActiveTypeForOpponent?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (activeTypeFlags(hostState, effect.sourceUid) & Number(blockedActiveTypeForOpponent[1])) === 0 };
  }
  const allowedActiveTypeForOpponent = predicate?.match(/^closure:active-type-response-player:(\d+)$/);
  if (allowedActiveTypeForOpponent?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || (activeTypeFlags(hostState, effect.sourceUid) & Number(allowedActiveTypeForOpponent[1])) !== 0 };
  }
  const sourceTypeNonActivateForOpponent = predicate?.match(/^closure:source-type-non-activate-response-player:(\d+)$/);
  if (sourceTypeNonActivateForOpponent?.[1]) {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || ((sourceTypeFlags(hostState, effect.sourceUid) & Number(sourceTypeNonActivateForOpponent[1])) !== 0 && (effectTypeFlags(hostState, effect.id) & 0x10) === 0) };
  }
  if (predicate === "closure:spell-trap-non-activate-response-player") {
    return { ...limit, allows: (effect, player, chainPlayer) => player === chainPlayer || ((sourceTypeFlags(hostState, effect.sourceUid) & 0x6) !== 0 && (effectTypeFlags(hostState, effect.id) & 0x10) === 0) };
  }
  const blockedActiveType = predicate?.match(/^closure:not-active-type:(\d+)$/);
  if (blockedActiveType?.[1]) return { ...limit, allows: (effect) => (activeTypeFlags(hostState, effect.sourceUid) & Number(blockedActiveType[1])) === 0 };
  const responsePlayer = predicate?.match(/^closure:response-player:([01])$/);
  if (responsePlayer?.[1]) return { ...limit, allows: (_effect, player) => player === Number(responsePlayer[1]) };
  if (predicate === "closure:response-matches-chain-player") return { ...limit, allows: (_effect, player, activeChainPlayer) => player === activeChainPlayer };
  const chainPlayer = predicate?.match(/^closure:chain-player:([01])$/);
  if (chainPlayer?.[1]) return { ...limit, allows: (_effect, _player, activeChainPlayer) => activeChainPlayer === Number(chainPlayer[1]) };
  const sourcePredicate = predicate?.match(/^closure:source:(.+)$/);
  if (sourcePredicate?.[1]) {
    const ref = compileLuaChainLimitSource(L, sourcePredicate[1]);
    if (ref === undefined) return undefined;
    return {
      ...limit,
      allows(effect, player, chainPlayer) {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
        pushLuaChainLimitEffect(L, hostState, effect.id);
        lua.lua_pushinteger(L, player);
        lua.lua_pushinteger(L, chainPlayer);
        const status = lua.lua_pcall(L, 3, 1, 0);
        if (status !== lua.LUA_OK) {
          readLuaError(L);
          return false;
        }
        const result = lua.lua_toboolean(L, -1);
        lua.lua_pop(L, 1);
        return Boolean(result);
      },
      release() {
        lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
      },
    };
  }
  const field = predicate?.match(/^(c\d+)\.([A-Za-z_]\w*)$/);
  if (!field) return undefined;
  const [, tableName, fieldName] = field;
  if (!tableName || !fieldName) return undefined;
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const hasNamedPredicate = lua.lua_isfunction(L, -1);
  lua.lua_pop(L, 2);
  if (!hasNamedPredicate) return undefined;
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
      if (status !== lua.LUA_OK) {
        readLuaError(L);
        lua.lua_pop(L, 1);
        return false;
      }
      const result = lua.lua_toboolean(L, -1);
      lua.lua_pop(L, 2);
      return Boolean(result);
    },
  };
}

function compileLuaChainLimitSource(L: unknown, encodedSource: string): number | undefined {
  let source: string;
  try {
    source = decodeURIComponent(encodedSource);
  }
  catch {
    return undefined;
  }
  source = restorableStatelessLuaChainLimitSource(source) ?? "";
  if (!source) return undefined;
  const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(`return ${source}`));
  if (loadStatus !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  const callStatus = lua.lua_pcall(L, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 1);
    return undefined;
  }
  return lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
}

function sourceTypeFlags(hostState: LuaHostState, sourceUid: string): number {
  return cardTypeFlags(hostState.session.state.cards.find((card) => card.uid === sourceUid), hostState.session.state);
}

function sourcePrintedTypeFlags(hostState: LuaHostState, sourceUid: string): number {
  const card = hostState.session.state.cards.find((candidate) => candidate.uid === sourceUid);
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
}

function activeTypeFlags(hostState: LuaHostState, sourceUid: string): number {
  return cardTypeFlags(hostState.session.state.cards.find((candidate) => candidate.uid === sourceUid), hostState.session.state);
}

function sourceHasSetcode(hostState: LuaHostState, sourceUid: string, requested: number): boolean {
  return hostState.session.state.cards.find((card) => card.uid === sourceUid)?.data.setcodes?.some((setcode) => isSetcodeMatch(requested, setcode)) ?? false;
}

function sourceHasLevel(hostState: LuaHostState, sourceUid: string): boolean {
  const flags = sourceTypeFlags(hostState, sourceUid);
  return (flags & 0x1) !== 0 && (flags & 0x800000) === 0 && (flags & 0x4000000) === 0;
}

function sourceCode(hostState: LuaHostState, sourceUid: string): string | undefined {
  return hostState.session.state.cards.find((card) => card.uid === sourceUid)?.code;
}

function sourceController(hostState: LuaHostState, sourceUid: string): PlayerId | undefined {
  return hostState.session.state.cards.find((card) => card.uid === sourceUid)?.controller;
}

function effectTypeFlags(hostState: LuaHostState, effectId: string): number {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  return (Number.isFinite(id) ? hostState.effects.get(id)?.typeFlags : undefined)
    ?? hostState.session.state.effects.find((effect) => effect.id === effectId)?.luaTypeFlags
    ?? 0;
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
