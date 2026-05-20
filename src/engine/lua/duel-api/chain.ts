import fengari from "fengari";
import { addDuelChainLimit, canNegateDuelChainLinkObject, negateDuelChainLinkObject } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { canLuaCardBeEffectTarget } from "#lua/card-effect-query-api.js";
import { pushCardTable } from "#lua/card-api.js";
import { capturedTypeMaskDescriptor, literalActionTypeChainPlayerLimitPredicate, literalCapturedPlayerComparisonPredicate, literalFalsePredicate, literalNotMonsterWithoutLevelActiveTypePredicate, literalNotOpponentControlledTrapPredicate, literalNotSourceOrActiveTypeAndEffectTypePredicateDescriptor, literalResponseMatchesChainPlayerOrActiveTypePredicate, literalResponseMatchesChainPlayerOrCurrentTargetCardsPredicate, literalResponseMatchesChainPlayerOrNotSourceTypePredicate, literalResponseMatchesChainPlayerOrSourceTypeNonActivatePredicate, literalStatelessSourcePredicate, literalTruePredicate } from "#lua/chain-limit-predicate-descriptors.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid, readOptionalFunctionRef, releaseOptionalFunctionRef, symbolicLocationMask } from "#lua/api-utils.js";
import { effectiveCardCodes } from "#lua/card-code-effect-utils.js";
import { effectiveCardSetcodes } from "#lua/card-setcode-utils.js";
import { cardTypeFlags, currentAttack, currentAttribute, currentDefense, currentLevel, currentRace, currentRank } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord } from "#lua/host-types.js";

const { lua, to_luastring, to_jsstring } = fengari;

export interface LuaDuelChainApiHostState {
  pushEffectTable: (state: unknown, id: number) => void;
  getEffectTypeFlags: (id: number) => number | undefined;
  changeChainOperation: (state: unknown, chainIndex: number, operationRef: number) => boolean;
  activeContext: DuelEffectContext | undefined;
  effects: Map<number, LuaEffectRecord>;
  loadedScriptBodies?: Map<string, string>;
}

export function installDuelChainApi(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, currentLuaChainCount(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentChain"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, currentLuaChainCount(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetChainCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainPlayer(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, session.state.status === "resolving" && hostState.activeContext?.chainLink !== undefined);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsChainSolving"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainInfo(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainEvent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainMaterial(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetChainLimit(state, session, hostState, false));
  lua.lua_setfield(L, -2, to_luastring("SetChainLimit"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetChainLimit(state, session, hostState, true));
  lua.lua_setfield(L, -2, to_luastring("SetChainLimitTillChainEnd"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsChainNegatable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsChainDisablable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("NegateActivation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("NegateEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateRelatedChain(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("NegateRelatedChain"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeTargetPlayer(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeTargetPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeTargetParam(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeTargetParam"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeChainOperation(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeChainOperation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckChainTarget(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckChainTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckChainUniqueness(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CheckChainUniqueness"));
}

function pushChainInfo(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  if (!link) {
    lua.lua_pushnil(L);
    return 1;
  }
  let pushed = 0;
  const top = lua.lua_gettop(L);
  for (let argIndex = 2; argIndex <= top; argIndex += 1) {
    const info = lua.lua_isnumber(L, argIndex) ? lua.lua_tointeger(L, argIndex) : 0;
    pushChainInfoValue(L, session, hostState, link, info);
    pushed += 1;
  }
  return pushed;
}

function pushChainPlayer(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  if (!link) {
    lua.lua_pushnil(L);
    return 1;
  }
  lua.lua_pushinteger(L, link.player);
  return 1;
}

function pushChainInfoValue(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState, link: DuelState["chain"][number], info: number): void {
  const source = session.state.cards.find((card) => card.uid === link.sourceUid);
  if (info === 1) {
    const id = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
    if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
    else lua.lua_pushnil(L);
  }
  else if (info === 2 || info === 3) lua.lua_pushinteger(L, link.player);
  else if (info === 4) lua.lua_pushinteger(L, locationMaskFromLocation(source?.location));
  else if (info === 5) lua.lua_pushinteger(L, symbolicLocationMask(source));
  else if (info === 6 || info === 7) lua.lua_pushinteger(L, link.activationSequence ?? source?.sequence ?? 0);
  else if (info === 8) pushGroupTable(L, link.targetUids ?? []);
  else if (info === 9 && link.targetPlayer !== undefined) lua.lua_pushinteger(L, link.targetPlayer);
  else if (info === 10 && link.targetParam !== undefined) lua.lua_pushinteger(L, link.targetParam);
  else if (info === 11) lua.lua_pushinteger(L, link.disableReason ?? 0);
  else if (info === 12) lua.lua_pushinteger(L, link.disablePlayer ?? 0);
  else if (info === 13) lua.lua_pushinteger(L, chainNumericId(link));
  else if (info === 14) lua.lua_pushinteger(L, chainEffectTypeFlags(link, hostState));
  else if (info === 15 || info === 19) lua.lua_pushinteger(L, cardTypeFlags(source, session.state));
  else if (info === 16) lua.lua_pushinteger(L, positionMaskFromPosition(source?.position));
  else if (info === 17) lua.lua_pushinteger(L, source ? Number(effectiveCardCodes(session.state, source, hostState)[0] ?? 0) : 0);
  else if (info === 18) lua.lua_pushinteger(L, source ? Number(effectiveCardCodes(session.state, source, hostState)[1] ?? 0) : 0);
  else if (info === 20) lua.lua_pushinteger(L, currentLevel(source, session.state));
  else if (info === 21) lua.lua_pushinteger(L, currentRank(source, session.state));
  else if (info === 22) lua.lua_pushinteger(L, currentAttribute(source, session.state));
  else if (info === 23) lua.lua_pushinteger(L, currentRace(source, session.state));
  else if (info === 24) lua.lua_pushinteger(L, currentAttack(source, session.state));
  else if (info === 25) lua.lua_pushinteger(L, currentDefense(source, session.state));
  else if (info === 26) lua.lua_pushinteger(L, 0);
  else if (info === 27) lua.lua_pushinteger(L, source?.summonType ? locationMaskFromLocation(source.previousLocation) : 0);
  else if (info === 28) lua.lua_pushinteger(L, summonTypeMask(source));
  else if (info === 29) lua.lua_pushboolean(L, Boolean(source?.summonType));
  else if (info === 30) pushNumberArrayTable(L, source ? effectiveCardSetcodes(session.state, source, hostState) : []);
  else if (info === 31 && source) pushCardTable(L, source.uid);
  else lua.lua_pushnil(L);
}

function pushNumberArrayTable(L: unknown, values: readonly number[]): void {
  lua.lua_newtable(L);
  for (const [index, value] of values.entries()) {
    lua.lua_pushinteger(L, value);
    lua.lua_rawseti(L, -2, index + 1);
  }
}

function pushChainEvent(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  if (!link) {
    lua.lua_pushnil(L);
    return 1;
  }
  const eventCard = link.eventCardUid === undefined ? undefined : session.state.cards.find((card) => card.uid === link.eventCardUid);
  pushGroupTable(L, link.eventUids ?? (eventCard ? [eventCard.uid] : []));
  lua.lua_pushinteger(L, link.eventPlayer ?? eventCard?.controller ?? link.player);
  lua.lua_pushinteger(L, link.eventValue ?? 0);
  pushRelatedEffectById(L, hostState, link.relatedEffectId);
  lua.lua_pushinteger(L, link.eventReason ?? eventCard?.reason ?? 0);
  lua.lua_pushinteger(L, link.eventReasonPlayer ?? eventCard?.reasonPlayer ?? eventCard?.controller ?? link.player);
  return 6;
}

function pushRelatedEffectById(L: unknown, hostState: LuaDuelChainApiHostState, relatedEffectId: number | undefined): void {
  if (relatedEffectId !== undefined && Number.isFinite(relatedEffectId)) hostState.pushEffectTable(L, relatedEffectId);
  else lua.lua_pushnil(L);
}

function pushChainMaterial(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  pushGroupTable(L, link?.targetUids ?? []);
  return 1;
}

function pushSetChainLimit(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState, untilChainEnd: boolean): number {
  const filterRef = readOptionalFunctionRef(L, 1);
  if (filterRef === undefined) return 0;
  const registryKey = knownLuaChainLimitRegistryKey(L, hostState, untilChainEnd) ?? luaChainLimitRegistryKey(hostState.activeContext, untilChainEnd, filterRef);
  addDuelChainLimit(session.state, {
    ...(registryKey === undefined ? {} : { registryKey }),
    ...(untilChainEnd || session.state.chain.length === 0 || (hostState.activeContext?.chainLink === undefined && hostState.activeContext?.eventName !== "chaining") ? {} : { expiresAtChainLength: session.state.chain.length }),
    untilChainEnd,
    allows: (effect, player, chainPlayer) => callChainLimit(L, hostState, filterRef, effect, player, chainPlayer),
    release: () => releaseOptionalFunctionRef(L, filterRef),
  });
  return 0;
}

function knownLuaChainLimitRegistryKey(L: unknown, hostState: LuaDuelChainApiHostState, untilChainEnd: boolean): string | undefined {
  const ctx = hostState.activeContext;
  if (!ctx?.source.code) return undefined;
  const known = knownLuaChainLimitPredicate(L, 1, hostState);
  return known ? `lua-chain-limit:${ctx.source.code}:${ctx.player}:${untilChainEnd ? "chain" : "link"}:known:${known}` : undefined;
}

function knownLuaChainLimitPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  if (isGlobalTableFunction(L, index, "aux", "FALSE") || literalFalsePredicate(L, index, hostState)) return "aux.FALSE";
  if (isGlobalTableFunction(L, index, "aux", "TRUE") || literalTruePredicate(L, index, hostState)) return "aux.TRUE";
  const allowedActiveTypeForOpponent = literalResponseMatchesChainPlayerOrActiveTypePredicate(L, index, hostState);
  if (allowedActiveTypeForOpponent !== undefined) return `closure:active-type-response-player:${allowedActiveTypeForOpponent}`;
  const blockedSourceOrActiveEffectType = literalNotSourceOrActiveTypeAndEffectTypePredicateDescriptor(L, index, hostState);
  if (blockedSourceOrActiveEffectType) return blockedSourceOrActiveEffectType;
  const currentTargetHandlerExclusionUids = literalResponseMatchesChainPlayerOrCurrentTargetCardsPredicate(L, index, hostState);
  if (currentTargetHandlerExclusionUids) return `closure:target-cards-not-handler-response-player:${currentTargetHandlerExclusionUids.map(encodeURIComponent).join(",")}`;
  if (literalNotMonsterWithoutLevelActiveTypePredicate(L, index, hostState)) return "closure:not-monster-without-level";
  const blockedEffectTypeForOpponent = literalResponseMatchesChainPlayerOrNotEffectTypePredicate(L, index, hostState);
  if (blockedEffectTypeForOpponent !== undefined) return `closure:not-effect-type-response-player:${blockedEffectTypeForOpponent}`;
  const blockedEffectType = literalNotEffectTypePredicate(L, index, hostState);
  if (blockedEffectType !== undefined) return `closure:not-effect-type:${blockedEffectType}`;
  if (literalResponseMatchesChainPlayerPredicate(L, index, hostState)) return "closure:response-matches-chain-player";
  const sourceTypeNonActivateForOpponent = literalResponseMatchesChainPlayerOrSourceTypeNonActivatePredicate(L, index, hostState);
  if (sourceTypeNonActivateForOpponent !== undefined) return `closure:source-type-non-activate-response-player:${sourceTypeNonActivateForOpponent}`;
  const blockedSourceTypeForOpponent = literalResponseMatchesChainPlayerOrNotSourceTypePredicate(L, index, hostState);
  if (blockedSourceTypeForOpponent !== undefined) return `closure:type-mask-response-player:${blockedSourceTypeForOpponent}`;
  const blockedActiveTypeForOpponent = literalResponseMatchesChainPlayerOrNotActiveTypePredicate(L, index, hostState);
  if (blockedActiveTypeForOpponent !== undefined) return `closure:not-active-type-response-player:${blockedActiveTypeForOpponent}`;
  if (literalNotMonsterLinkActiveTypePredicate(L, index, hostState)) return "closure:not-active-monster-link";
  const blockedActiveType = literalNotActiveTypePredicate(L, index, hostState);
  if (blockedActiveType !== undefined) return `closure:not-active-type:${blockedActiveType}`;
  const counterActivationOrHandlerCode = literalCounterActivationOrHandlerCodePredicate(L, index, hostState);
  if (counterActivationOrHandlerCode !== undefined) return `closure:counter-activate-or-handler-code:${counterActivationOrHandlerCode}`;
  if (literalNotOpponentControlledTrapPredicate(L, index, hostState)) return "closure:not-opponent-controlled-trap";
  const cardTableField = matchingGlobalCardTableFunctionField(L, index);
  if (cardTableField) return cardTableField;
  const handlerOnlyUid = literalCapturedHandlerOnlyCardUid(L, index, hostState);
  if (handlerOnlyUid) return `closure:card-handler:${handlerOnlyUid}`;
  const responsePlayerHandlerExclusionUids = literalCapturedHandlerExclusionResponsePlayerCardUids(L, index, hostState);
  if (responsePlayerHandlerExclusionUids?.length === 1) return `closure:card-not-handler-response-player:${responsePlayerHandlerExclusionUids[0]}`;
  if (responsePlayerHandlerExclusionUids && responsePlayerHandlerExclusionUids.length > 1) return `closure:cards-not-handler-response-player:${responsePlayerHandlerExclusionUids.map(encodeURIComponent).join(",")}`;
  const handlerExclusionUids = literalCapturedHandlerExclusionCardUids(L, index, hostState);
  if (handlerExclusionUids?.length === 1) return `closure:card-not-handler:${handlerExclusionUids[0]}`;
  if (handlerExclusionUids && handlerExclusionUids.length > 1) return `closure:cards-not-handler:${handlerExclusionUids.map(encodeURIComponent).join(",")}`;
  const targetHandlerExclusionUids = literalTargetCardsHandlerExclusionUids(L, index, hostState);
  if (targetHandlerExclusionUids) return `closure:target-cards-not-handler:${targetHandlerExclusionUids.map(encodeURIComponent).join(",")}`;
  const typeMask = capturedTypeMaskDescriptor(L, index, hostState);
  if (typeMask) return typeMask;
  const actionTypeChainPlayer = literalActionTypeChainPlayerLimitPredicate(L, index, hostState);
  if (actionTypeChainPlayer) return actionTypeChainPlayer;
  const responsePlayerHandlerCodes = literalResponseMatchesChainPlayerOrHandlerCodesPredicate(L, index, hostState);
  if (responsePlayerHandlerCodes !== undefined) return handlerCodeResponsePlayerPredicateDescriptor(responsePlayerHandlerCodes);
  const handlerCode = capturedHandlerCode(L, index);
  if (handlerCode !== undefined) return `closure:handler-code:${handlerCode}`;
  const literalHandlerCode = literalHandlerCodePredicate(L, index, hostState);
  if (literalHandlerCode !== undefined) return `closure:handler-code:${literalHandlerCode}`;
  const literalCapturedHandlerCode = literalCapturedHandlerCodePredicate(L, index, hostState);
  if (literalCapturedHandlerCode !== undefined) return `closure:handler-code:${literalCapturedHandlerCode}`;
  const literalHandlerCodes = literalHandlerCodesPredicate(L, index, hostState);
  if (literalHandlerCodes !== undefined) return handlerCodePredicateDescriptor(literalHandlerCodes);
  const capturedPlayerComparison = literalCapturedPlayerComparisonPredicate(L, index, hostState);
  if (capturedPlayerComparison) return capturedPlayerComparison;
  const responsePlayer = capturedResponsePlayer(L, index);
  if (responsePlayer !== undefined) return `closure:response-player:${responsePlayer}`;
  const chainPlayer = capturedChainPlayer(L, index);
  if (chainPlayer !== undefined) return `closure:chain-player:${chainPlayer}`;
  const statelessSource = literalStatelessSourcePredicate(L, index, hostState);
  if (statelessSource) return `closure:source:${encodeURIComponent(statelessSource)}`;
  return undefined;
}

function isGlobalTableFunction(L: unknown, index: number, tableName: string, fieldName: string): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const matches = lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1) !== 0;
  lua.lua_pop(L, 2);
  return matches;
}

function matchingGlobalCardTableFunctionField(L: unknown, index: number): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_pushglobaltable(L);
  lua.lua_pushnil(L);
  while (lua.lua_next(L, -2) !== 0) {
    const globalName = lua.lua_isstring(L, -2) ? lua.lua_tojsstring(L, -2) : undefined;
    if (globalName?.match(/^c\d+$/) && lua.lua_istable(L, -1)) {
      const fieldName = matchingTableFunctionField(L, -1, absoluteIndex);
      if (fieldName) {
        lua.lua_pop(L, 3);
        return `${globalName}.${fieldName}`;
      }
    }
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1);
  return undefined;
}
function matchingTableFunctionField(L: unknown, tableIndex: number, functionIndex: number): string | undefined {
  const absoluteTableIndex = lua.lua_absindex(L, tableIndex);
  lua.lua_pushnil(L);
  while (lua.lua_next(L, absoluteTableIndex) !== 0) {
    const fieldName = lua.lua_isstring(L, -2) ? lua.lua_tojsstring(L, -2) : undefined;
    const matches = fieldName !== undefined && lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, functionIndex, -1) !== 0;
    lua.lua_pop(L, 1);
    if (matches) {
      lua.lua_pop(L, 1);
      return fieldName;
    }
  }
  return undefined;
}
function literalCapturedHandlerExclusionResponsePlayerCardUids(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string[] | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const [effectParam, responsePlayerParam, chainPlayerParam] = luaFunctionParams(snippet) ?? [];
  const returnExpression = lastReturnExpression(snippet);
  if (!effectParam || !responsePlayerParam || !chainPlayerParam || !returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length !== 2) return undefined;
  const equality = terms.find((term) => responseMatchesChainPlayerTerm(term, responsePlayerParam, chainPlayerParam));
  const exclusion = terms.find((term) => term !== equality);
  if (!equality || !exclusion) return undefined;
  const upvalues = capturedCardOrNilUpvalues(L, index);
  if (!upvalues || upvalues.size === 0) return undefined;
  const handlerExpression = [
    `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`,
    ...[...snippet.matchAll(new RegExp(`local\\s+([A-Za-z_]\\w*)\\s*=\\s*${effectParam}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`, "g"))].flatMap((match) => match[1] ? [escapeRegExp(match[1])] : []),
  ].join("|");
  const blockedUids = new Set<string>();
  const comparisons = [...exclusion.matchAll(new RegExp(`(?:${handlerExpression})\\s*~=\\s*([A-Za-z_]\\w*)|([A-Za-z_]\\w*)\\s*~=\\s*(?:${handlerExpression})`, "g"))];
  for (const comparison of comparisons) {
    const capturedName = comparison[1] ?? comparison[2];
    if (!capturedName || !upvalues.has(capturedName)) return undefined;
    const uid = upvalues.get(capturedName);
    if (uid) blockedUids.add(uid);
  }
  return blockedUids.size > 0 ? [...blockedUids].sort() : undefined;
}
function literalCapturedHandlerExclusionCardUids(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string[] | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  if (!effectParam) return undefined;
  const upvalues = capturedCardOrNilUpvalues(L, index);
  if (!upvalues || upvalues.size === 0) return undefined;
  const aliases = [...snippet.matchAll(new RegExp(`local\\s+([A-Za-z_]\\w*)\\s*=\\s*${effectParam}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`, "g"))].map((match) => match[1]).filter(Boolean);
  const handlerExpressions = [`${effectParam}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`, ...aliases].join("|");
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const blockedUids = new Set<string>();
  for (const term of returnExpression.split(/\s+and\s+/).map((part) => part.trim()).filter(Boolean)) {
    const rightComparison = term.match(new RegExp(`^(?:${handlerExpressions})\\s*~=\\s*([A-Za-z_]\\w*)$`));
    const leftComparison = term.match(new RegExp(`^([A-Za-z_]\\w*)\\s*~=\\s*(?:${handlerExpressions})$`));
    const capturedName = rightComparison?.[1] ?? leftComparison?.[1];
    if (!capturedName || !upvalues.has(capturedName)) return undefined;
    const uid = upvalues.get(capturedName);
    if (uid) blockedUids.add(uid);
  }
  return blockedUids.size > 0 ? [...blockedUids].sort() : undefined;
}
function literalCapturedHandlerOnlyCardUid(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  if (!effectParam) return undefined;
  const upvalues = capturedCardOrNilUpvalues(L, index);
  if (!upvalues || upvalues.size !== 1) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const handlerExpression = `${effectParam}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const rightComparison = returnExpression.match(new RegExp(`^(?:${handlerExpression})\\s*==\\s*([A-Za-z_]\\w*)$`));
  const leftComparison = returnExpression.match(new RegExp(`^([A-Za-z_]\\w*)\\s*==\\s*(?:${handlerExpression})$`));
  const capturedName = rightComparison?.[1] ?? leftComparison?.[1];
  if (!capturedName) return undefined;
  return upvalues.get(capturedName);
}
function lastReturnExpression(snippet: string): string | undefined {
  const index = snippet.lastIndexOf("return ");
  if (index < 0) return undefined;
  return snippet.slice(index + "return ".length).replace(/\s*end\b.*$/, "").trim();
}
function capturedCardOrNilUpvalues(L: unknown, index: number): Map<string, string | undefined> | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const upvalues = new Map<string, string | undefined>();
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      const cardUid = readCardUid(L, -1);
      if (!cardUid && !lua.lua_isnil(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      upvalues.set(name, cardUid);
    }
    lua.lua_pop(L, 1);
  }
  return upvalues;
}
function literalTargetCardsHandlerExclusionUids(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string[] | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  const capturedNames = nonEnvironmentUpvalueNames(L, index);
  const targetEffectParam = capturedNames.length === 1 ? capturedNames[0] : undefined;
  const targetUids = [...new Set(hostState.activeContext?.targetUids ?? [])].sort();
  if (!effectParam || !targetEffectParam || targetUids.length === 0) return undefined;
  const targetGroupContainsHandler = [
    String.raw`Duel\s*\.\s*GetTargetCards\s*\(\s*`,
    escapeRegExp(targetEffectParam),
    String.raw`\s*\)\s*:\s*IsContains\s*\(\s*`,
    escapeRegExp(effectParam),
    String.raw`\s*:\s*GetHandler\s*\(\s*\)\s*\)`,
  ].join("");
  return new RegExp(String.raw`\breturn\s+not\s+${targetGroupContainsHandler}(?:\s+end\b|$)`).test(snippet) ? targetUids : undefined;
}
function capturedHandlerCode(L: unknown, index: number): number | undefined {
  const captured = capturedSingleNumberUpvalue(L, index, isHandlerCodeUpvalueName);
  return captured !== undefined && captured > 0 ? captured : undefined;
}
function literalHandlerCodePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const match = snippet.match(/return\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*(?:GetCode|IsCode)\s*\(\s*\)\s*==\s*(\d+)/)
    ?? snippet.match(/return\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsCode\s*\(\s*(\d+)\s*\)/);
  const code = match?.[1] ? Number(match[1]) : undefined;
  return code !== undefined && Number.isSafeInteger(code) && code > 0 ? code : undefined;
}
function literalCapturedHandlerCodePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  if (!effectParam) return undefined;
  const upvalues = capturedNumberUpvalues(L, index);
  if (!upvalues || upvalues.size === 0) return undefined;
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const identifier = "([A-Za-z_]\\w*)";
  const rightIsCode = snippet.match(new RegExp(`return\\s+${handler}\\s*:\\s*IsCode\\s*\\(\\s*${identifier}\\s*\\)`));
  const rightGetCode = snippet.match(new RegExp(`return\\s+${handler}\\s*:\\s*GetCode\\s*\\(\\s*\\)\\s*==\\s*${identifier}`));
  const leftGetCode = snippet.match(new RegExp(`return\\s+${identifier}\\s*==\\s*${handler}\\s*:\\s*GetCode\\s*\\(\\s*\\)`));
  const capturedName = rightIsCode?.[1] ?? rightGetCode?.[1] ?? leftGetCode?.[1];
  const code = capturedName ? upvalues.get(capturedName) : undefined;
  return code !== undefined && Number.isSafeInteger(code) && code > 0 ? code : undefined;
}

function literalHandlerCodesPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number[] | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  if (!effectParam) return undefined;
  const upvalues = capturedNumberUpvalues(L, index);
  if (upvalues === undefined) return undefined;
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const match = snippet.match(new RegExp(`return\\s+${handler}\\s*:\\s*IsCode\\s*\\(\\s*([^)]*?,[^)]*?)\\s*\\)`));
  const codes = match?.[1]?.split(",").map((part) => numberTokenValue(part.trim(), upvalues));
  if (!codes || codes.some((code) => code === undefined)) return undefined;
  const uniqueCodes = [...new Set(codes)].filter((code): code is number => code !== undefined).sort((a, b) => a - b);
  return uniqueCodes.length > 0 && uniqueCodes.every((code) => Number.isSafeInteger(code) && code > 0) ? uniqueCodes : undefined;
}

function numberTokenValue(token: string, upvalues: Map<string, number>): number | undefined { return /^\d+$/.test(token) ? Number(token) : /^[A-Za-z_]\w*$/.test(token) ? upvalues.get(token) : undefined; }
function handlerCodePredicateDescriptor(codes: number[]): string { return codes.length === 1 ? `closure:handler-code:${codes[0]}` : `closure:handler-codes:${codes.join(",")}`; }
function handlerCodeResponsePlayerPredicateDescriptor(codes: number[]): string { return codes.length === 1 ? `closure:handler-code-response-player:${codes[0]}` : `closure:handler-codes-response-player:${codes.join(",")}`; }

function literalResponseMatchesChainPlayerOrHandlerCodesPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number[] | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = snippet.match(/function\s*\(([^)]*)\)/)?.[1]?.split(",").map((param) => param.trim()).filter(Boolean);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const returnExpression = lastReturnExpression(snippet);
  if (!returnExpression) return undefined;
  const terms = returnExpression.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (terms.length < 2) return undefined;
  const equality = terms.find((term) => responseMatchesChainPlayerTerm(term, responsePlayerParam, chainPlayerParam));
  const codeTerms = terms.filter((term) => term !== equality);
  if (!equality || codeTerms.length === 0) return undefined;
  const upvalues = capturedNumberUpvalues(L, index);
  const codes = codeTerms.flatMap((term) => handlerCodeTermValues(term, effectParam, upvalues) ?? [undefined]);
  if (codes.length === 0 || codes.some((code) => code === undefined)) return undefined;
  const uniqueCodes = [...new Set(codes)].filter((code): code is number => code !== undefined).sort((a, b) => a - b);
  return uniqueCodes.every((code) => Number.isSafeInteger(code) && code > 0) ? uniqueCodes : undefined;
}

function literalCounterActivationOrHandlerCodePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const effectParam = luaFunctionParams(snippet)?.[0];
  const terms = lastReturnExpression(snippet)?.split(/\s+or\s+/).map((term) => trimOuterParens(term.trim())).filter(Boolean);
  if (!effectParam || !terms || terms.length !== 2) return undefined;
  const effect = escapeRegExp(effectParam), counterActivate = new RegExp(`^${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(?:TYPE_COUNTER|1048576)\\s*\\)\\s+and\\s+${effect}\\s*:\\s*IsHasType\\s*\\(\\s*(?:EFFECT_TYPE_ACTIVATE|16)\\s*\\)$`);
  const codeTerm = terms.find((term) => !counterActivate.test(term)), codes = codeTerm ? handlerCodeTermValues(codeTerm, effectParam, capturedNumberUpvalues(L, index)) : undefined;
  return terms.some((term) => counterActivate.test(term)) && codes?.length === 1 ? codes[0] : undefined;
}
function responseMatchesChainPlayerTerm(term: string, responsePlayerParam: string, chainPlayerParam: string): boolean {
  const equality = term.match(/^([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)$/);
  return Boolean(equality?.[1] && equality[2] && [equality[1], equality[2]].sort().join(":") === [responsePlayerParam, chainPlayerParam].sort().join(":"));
}

function handlerCodeTermValues(term: string, effectParam: string, upvalues: Map<string, number> | undefined): number[] | undefined {
  if (upvalues === undefined) return undefined;
  const handler = `${escapeRegExp(effectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const isCode = term.match(new RegExp(`^${handler}\\s*:\\s*IsCode\\s*\\(\\s*([^)]*?)\\s*\\)$`));
  if (isCode?.[1]) {
    const codes = isCode[1].split(",").map((part) => numberTokenValue(part.trim(), upvalues));
    return codes.some((code) => code === undefined) ? undefined : codes.filter((code): code is number => code !== undefined);
  }
  const rightGetCode = term.match(new RegExp(`^${handler}\\s*:\\s*GetCode\\s*\\(\\s*\\)\\s*==\\s*([A-Za-z_]\\w*|\\d+)$`));
  const leftGetCode = term.match(new RegExp(`^([A-Za-z_]\\w*|\\d+)\\s*==\\s*${handler}\\s*:\\s*GetCode\\s*\\(\\s*\\)$`));
  const code = numberTokenValue((rightGetCode?.[1] ?? leftGetCode?.[1] ?? "").trim(), upvalues);
  return code === undefined ? undefined : [code];
}

function trimOuterParens(value: string): string {
  let current = value.trim();
  while (current.startsWith("(") && current.endsWith(")") && outerParensWrapWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function outerParensWrapWholeExpression(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function literalResponseMatchesChainPlayerPredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const params = luaFunctionParams(snippet);
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  const equality = snippet.match(/return\s+([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\s*(?:;?\s*end\b|$)/);
  if (!responsePlayerParam || !chainPlayerParam || !equality?.[1] || !equality[2]) return false;
  const compared = [equality[1], equality[2]].sort().join(":");
  return compared === [responsePlayerParam, chainPlayerParam].sort().join(":");
}

function hasNonEnvironmentUpvalues(L: unknown, index: number): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return false;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    lua.lua_pop(L, 1);
    if (name !== "_ENV") return true;
  }
}

function nonEnvironmentUpvalueNames(L: unknown, index: number): string[] {
  const absoluteIndex = lua.lua_absindex(L, index);
  const names: string[] = [];
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return names;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    lua.lua_pop(L, 1);
    if (name !== "_ENV") names.push(name);
  }
}

function literalNotEffectTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const match = snippet.match(new RegExp(`return\\s+not\\s+([A-Za-z_]\\w*)\\s*:\\s*IsHasType\\s*\\(\\s*(${effectTypeMaskExpressionPattern})\\s*\\)`));
  if (!effectParam || match?.[1] !== effectParam || !match[2]) return undefined;
  const mask = effectTypeMaskTokenValue(match[2]);
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function literalResponseMatchesChainPlayerOrNotEffectTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const effectTypePattern = `not\\s+${escapeRegExp(effectParam)}\\s*:\\s*IsHasType\\s*\\(\\s*(${effectTypeMaskExpressionPattern})\\s*\\)`;
  const equalityPattern = `(?:${escapeRegExp(responsePlayerParam)}\\s*==\\s*${escapeRegExp(chainPlayerParam)}|${escapeRegExp(chainPlayerParam)}\\s*==\\s*${escapeRegExp(responsePlayerParam)})`;
  const match = snippet.match(new RegExp(`return\\s+(?:${equalityPattern})\\s+or\\s+${effectTypePattern}`))
    ?? snippet.match(new RegExp(`return\\s+${effectTypePattern}\\s+or\\s+(?:${equalityPattern})`));
  const token = match?.[1] ?? match?.[2];
  if (!token) return undefined;
  const mask = effectTypeMaskTokenValue(token);
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

const numericMaskPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+)`;
const effectTypeMaskExpressionPattern = String.raw`(?:[A-Za-z_]\w*|${numericMaskPattern})(?:\s*(?:\+|\|)\s*(?:[A-Za-z_]\w*|${numericMaskPattern}))*`;
const effectTypeMasks: Record<string, number> = {
  EFFECT_TYPE_SINGLE: 0x1,
  EFFECT_TYPE_FIELD: 0x2,
  EFFECT_TYPE_EQUIP: 0x4,
  EFFECT_TYPE_ACTIVATE: 0x10,
  EFFECT_TYPE_IGNITION: 0x40,
  EFFECT_TYPE_TRIGGER_O: 0x80,
  EFFECT_TYPE_QUICK_O: 0x100,
  EFFECT_TYPE_TRIGGER_F: 0x200,
  EFFECT_TYPE_QUICK_F: 0x400,
  EFFECT_TYPE_CONTINUOUS: 0x800,
};

function effectTypeMaskTokenValue(token: string): number | undefined {
  const parts = token.split(/\s*(?:\+|\|)\s*/).filter(Boolean);
  if (parts.length === 0) return undefined;
  let mask = 0;
  for (const part of parts) {
    const value = effectTypeMasks[part] ?? parseNumericMaskPart(part);
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return undefined;
    mask |= value;
  }
  return mask;
}

function literalNotActiveTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  if (!effectParam) return undefined;
  const compatibilityMatch = snippet.match(/return\s+not\s+([A-Za-z_]\w*)\s*:\s*(IsMonsterEffect|IsSpellEffect|IsTrapEffect)\s*\(\s*\)/);
  if (compatibilityMatch?.[1] === effectParam && compatibilityMatch[2]) return activeTypeMethodMask(compatibilityMatch[2]);
  const directMatch = snippet.match(new RegExp(`return\\s+not\\s+${escapeRegExp(effectParam)}\\s*:\\s*IsActiveType\\s*\\(\\s*(${activeTypeMaskExpressionPattern})\\s*\\)`));
  const mask = directMatch?.[1] ? activeTypeMaskTokenValue(directMatch[1]) : undefined;
  if (mask !== undefined && Number.isSafeInteger(mask) && mask > 0) return mask;
  return undefined;
}

function literalNotMonsterLinkActiveTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): boolean {
  if (hasNonEnvironmentUpvalues(L, index)) return false;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return false;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  if (!effectParam) return false;
  return new RegExp(`return\\s+not\\s*\\(\\s*${effectParam}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+and\\s+${effectParam}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLinkMonster\\s*\\(\\s*\\)\\s*\\)`).test(snippet);
}

function literalResponseMatchesChainPlayerOrNotActiveTypePredicate(L: unknown, index: number, hostState: LuaDuelChainApiHostState): number | undefined {
  if (hasNonEnvironmentUpvalues(L, index)) return undefined;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  const effectParam = params?.[0];
  const responsePlayerParam = params?.[1];
  const chainPlayerParam = params?.[2];
  if (!effectParam || !responsePlayerParam || !chainPlayerParam) return undefined;
  const activeTypePattern = `not\\s+${effectParam}\\s*:\\s*(IsMonsterEffect|IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)`;
  const equalityPattern = `(?:${responsePlayerParam}\\s*==\\s*${chainPlayerParam}|${chainPlayerParam}\\s*==\\s*${responsePlayerParam})`;
  const match = snippet.match(new RegExp(`return\\s+(?:${equalityPattern})\\s+or\\s+${activeTypePattern}`))
    ?? snippet.match(new RegExp(`return\\s+${activeTypePattern}\\s+or\\s+(?:${equalityPattern})`));
  const method = match?.[1] ?? match?.[2];
  const compatibilityMask = method ? activeTypeMethodMask(method) : undefined;
  if (compatibilityMask !== undefined) return compatibilityMask;

  const directActiveTypePattern = `not\\s+${effectParam}\\s*:\\s*IsActiveType\\s*\\(\\s*(${activeTypeMaskExpressionPattern})\\s*\\)`;
  const directMatch = snippet.match(new RegExp(`return\\s+(?:${equalityPattern})\\s+or\\s+${directActiveTypePattern}`))
    ?? snippet.match(new RegExp(`return\\s+${directActiveTypePattern}\\s+or\\s+(?:${equalityPattern})`));
  const token = directMatch?.[1] ?? directMatch?.[2];
  const mask = token ? activeTypeMaskTokenValue(token) : undefined;
  return mask !== undefined && Number.isSafeInteger(mask) && mask > 0 ? mask : undefined;
}

function activeTypeMethodMask(method: string): number | undefined { return method === "IsMonsterEffect" ? 0x1 : method === "IsSpellEffect" ? 0x2 : method === "IsTrapEffect" ? 0x4 : undefined; }

const activeTypeMaskExpressionPattern = String.raw`(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|TYPE_NORMAL|TYPE_EFFECT|TYPE_FUSION|TYPE_RITUAL|TYPE_TRAPMONSTER|TYPE_SPIRIT|TYPE_UNION|TYPE_GEMINI|TYPE_TUNER|TYPE_SYNCHRO|TYPE_TOKEN|TYPE_MAXIMUM|TYPE_QUICKPLAY|TYPE_CONTINUOUS|TYPE_EQUIP|TYPE_FIELD|TYPE_COUNTER|TYPE_FLIP|TYPE_TOON|TYPE_XYZ|TYPE_PENDULUM|TYPE_SPSUMMON|TYPE_LINK|TYPE_SKILL|${numericMaskPattern})(?:\s*(?:\+|\|)\s*(?:TYPE_MONSTER|TYPE_SPELL|TYPE_TRAP|TYPE_NORMAL|TYPE_EFFECT|TYPE_FUSION|TYPE_RITUAL|TYPE_TRAPMONSTER|TYPE_SPIRIT|TYPE_UNION|TYPE_GEMINI|TYPE_TUNER|TYPE_SYNCHRO|TYPE_TOKEN|TYPE_MAXIMUM|TYPE_QUICKPLAY|TYPE_CONTINUOUS|TYPE_EQUIP|TYPE_FIELD|TYPE_COUNTER|TYPE_FLIP|TYPE_TOON|TYPE_XYZ|TYPE_PENDULUM|TYPE_SPSUMMON|TYPE_LINK|TYPE_SKILL|${numericMaskPattern}))*`;
const activeTypeMasks: Record<string, number> = {
  TYPE_MONSTER: 0x1,
  TYPE_SPELL: 0x2,
  TYPE_TRAP: 0x4,
  TYPE_NORMAL: 0x10,
  TYPE_EFFECT: 0x20,
  TYPE_FUSION: 0x40,
  TYPE_RITUAL: 0x80,
  TYPE_TRAPMONSTER: 0x100,
  TYPE_SPIRIT: 0x200,
  TYPE_UNION: 0x400,
  TYPE_GEMINI: 0x800,
  TYPE_TUNER: 0x1000,
  TYPE_SYNCHRO: 0x2000,
  TYPE_TOKEN: 0x4000,
  TYPE_MAXIMUM: 0x8000,
  TYPE_QUICKPLAY: 0x10000,
  TYPE_CONTINUOUS: 0x20000,
  TYPE_EQUIP: 0x40000,
  TYPE_FIELD: 0x80000,
  TYPE_COUNTER: 0x100000,
  TYPE_FLIP: 0x200000,
  TYPE_TOON: 0x400000,
  TYPE_XYZ: 0x800000,
  TYPE_PENDULUM: 0x1000000,
  TYPE_SPSUMMON: 0x2000000,
  TYPE_LINK: 0x4000000,
  TYPE_SKILL: 0x8000000,
};

function activeTypeMaskTokenValue(token: string): number | undefined {
  const parts = token.split(/\s*(?:\+|\|)\s*/).filter(Boolean);
  if (parts.length === 0) return undefined;
  let mask = 0;
  for (const part of parts) {
    const value = activeTypeMasks[part] ?? parseNumericMaskPart(part);
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return undefined;
    mask |= value;
  }
  return mask;
}

function parseNumericMaskPart(part: string): number | undefined { return /^0x[0-9A-Fa-f]+$/.test(part) ? Number.parseInt(part.slice(2), 16) : /^\d+$/.test(part) ? Number(part) : undefined; }

function luaFunctionParams(snippet: string): string[] | undefined {
  const match = snippet.match(/function\s+(?:[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)\s*\(([^)]*)\)/)
    ?? snippet.match(/function\s*\(([^)]*)\)/);
  const params = match?.[1];
  return params?.split(",").map((param) => param.trim()).filter(Boolean);
}

function luaFunctionSourceSnippet(L: unknown, index: number, hostState: LuaDuelChainApiHostState): string | undefined {
  const location = luaFunctionSourceLocation(L, index);
  if (!location) return undefined;
  const source = hostState.loadedScriptBodies?.get(location.source);
  if (!source) return undefined;
  return source.split(/\r?\n/).slice(location.line - 1, location.lastLine).join(" ");
}

function luaFunctionSourceLocation(L: unknown, index: number): { source: string; line: number; lastLine: number } | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring("debug"));
  lua.lua_getfield(L, -1, to_luastring("getinfo"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  lua.lua_pushstring(L, to_luastring("S"));
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK || !lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 2);
    return undefined;
  }
  const source = readStringField(L, -1, "source");
  const line = readIntegerField(L, -1, "linedefined");
  const lastLine = readIntegerField(L, -1, "lastlinedefined");
  lua.lua_pop(L, 2);
  if (!source || line === undefined || lastLine === undefined || line < 1 || lastLine < line) return undefined;
  return { source, line, lastLine };
}

function readStringField(L: unknown, tableIndex: number, field: string): string | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readIntegerField(L: unknown, tableIndex: number, field: string): number | undefined {
  lua.lua_getfield(L, tableIndex, to_luastring(field));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function isHandlerCodeUpvalueName(name: string): boolean {
  return name === "code" || name === "cardCode" || name === "card_code" || name === "handlerCode" || name === "handler_code";
}

function capturedResponsePlayer(L: unknown, index: number): PlayerId | undefined {
  const captured = capturedSinglePlayerUpvalue(L, index, isResponsePlayerUpvalueName);
  return captured === 0 || captured === 1 ? captured : undefined;
}

function isResponsePlayerUpvalueName(name: string): boolean {
  return name === "responsePlayer" || name === "response_player" || name === "rp";
}

function capturedChainPlayer(L: unknown, index: number): PlayerId | undefined {
  const captured = capturedSinglePlayerUpvalue(L, index, isChainPlayerUpvalueName);
  return captured === 0 || captured === 1 ? captured : undefined;
}

function capturedSinglePlayerUpvalue(L: unknown, index: number, matchesName: (name: string) => boolean): number | undefined {
  return capturedSingleNumberUpvalue(L, index, matchesName);
}

function capturedSingleNumberUpvalue(L: unknown, index: number, matchesName: (name: string) => boolean): number | undefined {
  const numbers = capturedNumberUpvalues(L, index);
  if (!numbers) return undefined;
  const entries = [...numbers].map(([name, value]) => ({ name, value }));
  return entries.length === 1 && matchesName(entries[0]!.name) ? entries[0]!.value : undefined;
}

function capturedNumberUpvalues(L: unknown, index: number): Map<string, number> | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const numbers = new Map<string, number>();
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (!lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      numbers.set(name, lua.lua_tointeger(L, -1));
    }
    lua.lua_pop(L, 1);
  }
  return numbers;
}

function isChainPlayerUpvalueName(name: string): boolean {
  return name === "chainPlayer" || name === "chain_player" || name === "cp";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function luaChainLimitRegistryKey(ctx: DuelEffectContext | undefined, untilChainEnd: boolean, filterRef: number): string | undefined {
  return ctx?.source.code ? `lua-chain-limit:${ctx.source.code}:${ctx.player}:${untilChainEnd ? "chain" : "link"}:${filterRef}` : undefined;
}

function callChainLimit(
  L: unknown,
  hostState: LuaDuelChainApiHostState,
  filterRef: number,
  effect: DuelEffectDefinition,
  player: PlayerId,
  chainPlayer: PlayerId,
): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushEffectByDuelId(L, hostState, effect.id);
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
}

function pushEffectByDuelId(L: unknown, hostState: LuaDuelChainApiHostState, effectId: string): void {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
}

function pushIsChainNegatable(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const target = chainLinkByLuaArg(L, session, hostState);
  lua.lua_pushboolean(L, Boolean(target && canNegateDuelChainLinkObject(session.state, target)));
  return 1;
}

function pushNegateChainLink(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const target = chainLinkByLuaArg(L, session, hostState);
  if (!target || target.negated) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const source = session.state.cards.find((candidate) => candidate.uid === target.sourceUid);
  const activeSource = hostState.activeContext?.source;
  lua.lua_pushboolean(L, negateDuelChainLinkObject(
    session.state,
    target,
    hostState.activeContext?.player ?? activeSource?.controller ?? source?.controller ?? session.state.turnPlayer,
    activeSource?.name ?? source?.name ?? "Lua effect",
  ));
  return 1;
}

function pushNegateRelatedChain(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const cardUid = readCardUid(L, 1);
  if (!cardUid) return 0;
  const source = session.state.cards.find((candidate) => candidate.uid === cardUid);
  const activeSource = hostState.activeContext?.source;
  const player = hostState.activeContext?.player ?? activeSource?.controller ?? source?.controller ?? session.state.turnPlayer;
  const cardName = activeSource?.name ?? source?.name ?? "Lua effect";
  for (const link of session.state.chain.filter((candidate) => candidate.sourceUid === cardUid)) {
    negateDuelChainLinkObject(session.state, link, player, cardName);
  }
  return 0;
}

function pushChangeTargetPlayer(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const player = readOptionalPlayer(L, 2);
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  if (link && player !== undefined) {
    link.targetPlayer = player;
    if (hostState.activeContext?.chainLink === link) hostState.activeContext.targetPlayer = player;
  }
  return 0;
}

function pushChangeTargetParam(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  if (link && lua.lua_isnumber(L, 2)) {
    const parameter = lua.lua_tointeger(L, 2);
    link.targetParam = parameter;
    if (hostState.activeContext?.chainLink === link) hostState.activeContext.targetParam = parameter;
  }
  return 0;
}

function pushChangeChainOperation(L: unknown, hostState: LuaDuelChainApiHostState): number {
  const chainIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  const operationRef = readOptionalFunctionRef(L, 2);
  if (operationRef === undefined) return 0;
  if (!hostState.changeChainOperation(L, chainIndex, operationRef)) releaseOptionalFunctionRef(L, operationRef);
  return 0;
}

function pushCheckChainTarget(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const cardUid = readCardUid(L, 2);
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  lua.lua_pushboolean(L, Boolean(cardUid && link && chainTargetAcceptsCard(L, session, hostState, link, cardUid)));
  return 1;
}

function chainTargetAcceptsCard(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState, link: DuelState["chain"][number], cardUid: string): boolean {
  if (link.targetUids?.includes(cardUid)) return true;
  const candidate = session.state.cards.find((card) => card.uid === cardUid);
  const source = session.state.cards.find((card) => card.uid === link.sourceUid);
  const effect = session.state.effects.find((duelEffect) => duelEffect.id === link.effectId && duelEffect.sourceUid === link.sourceUid);
  if (!candidate || !source || !effect) return false;
  const luaEffectId = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
  const targetEffect = Number.isFinite(luaEffectId) ? hostState.effects.get(luaEffectId) : undefined;
  if (targetEffect && !canLuaCardBeEffectTarget(L, session, hostState, candidate, targetEffect)) return false;
  if (!effect.targetCardPredicate) return Boolean(link.targetUids?.length && ((effect.property ?? 0) & 0x10) !== 0);
  const ctx = createEffectContext(
    session.state,
    source,
    link.player,
    link.eventName,
    link.eventCardUid === undefined ? undefined : session.state.cards.find((card) => card.uid === link.eventCardUid),
    [...(link.targetUids ?? [])],
    true,
    link.activationLocation,
    link.activationSequence,
    link.targetPlayer,
    link.targetParam,
    link,
    link.eventCode,
    link.eventPlayer,
    link.eventValue,
    link.eventReason,
    link.eventReasonPlayer,
    link.eventReasonCardUid,
    link.eventReasonEffectId,
    link.relatedEffectId,
    link.eventChainDepth,
    link.eventChainLinkId,
    link.eventUids,
  );
  return effect.targetCardPredicate(ctx, candidate) || Boolean(link.targetUids?.length && ((effect.property ?? 0) & 0x10) !== 0);
}

function pushCheckChainUniqueness(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const seenCodes = new Set<string>();
  for (const link of currentChainLinks(session, hostState)) {
    const source = session.state.cards.find((card) => card.uid === link.sourceUid);
    if (!source) continue;
    if (seenCodes.has(source.code)) {
      lua.lua_pushboolean(L, false);
      return 1;
    }
    seenCodes.add(source.code);
  }
  lua.lua_pushboolean(L, true);
  return 1;
}

function currentChainLinks(session: DuelSession, hostState: LuaDuelChainApiHostState): DuelState["chain"] {
  const activeLink = hostState.activeContext?.chainLink;
  if (!activeLink || session.state.chain.some((link) => link.id === activeLink.id)) return session.state.chain;
  return [...session.state.chain, activeLink];
}

function currentLuaChainCount(session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const activeLink = hostState.activeContext?.chainLink;
  if (session.state.status === "resolving" && activeLink) return activeLink.chainIndex ?? Math.max(session.state.chain.length, 1);
  return session.state.chain.length;
}

function chainLinkByLuaArg(L: unknown, session: DuelSession, hostState?: LuaDuelChainApiHostState): DuelState["chain"][number] | undefined {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  return chainLinkByLuaIndex(session, requestedIndex, hostState);
}

function chainLinkByLuaIndex(session: DuelSession, requestedIndex: number, hostState?: LuaDuelChainApiHostState): DuelState["chain"][number] | undefined {
  const activeLink = hostState?.activeContext?.chainLink;
  if (requestedIndex <= 0) return activeLink ?? session.state.chain[session.state.chain.length - 1];
  if (activeLink?.chainIndex === requestedIndex) return activeLink;
  return session.state.chain.find((link) => link.chainIndex === requestedIndex) ?? session.state.chain[requestedIndex - 1];
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function chainEffectTypeFlags(link: DuelState["chain"][number], hostState: LuaDuelChainApiHostState): number {
  const id = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? hostState.getEffectTypeFlags(id) ?? 0 : 0;
}

function readLuaError(L: unknown): void { lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); }

function chainNumericId(link: DuelState["chain"][number]): number {
  const id = Number(link.id.match(/^chain-(\d+)$/)?.[1]);
  return Number.isFinite(id) ? id : 0;
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

function positionMaskFromPosition(position: DuelCardInstance["position"] | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}
