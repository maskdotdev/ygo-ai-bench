import fengari from "fengari";
import { addDuelChainLimit, canNegateDuelChainLink, negateDuelChainLink } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid, readOptionalFunctionRef, releaseOptionalFunctionRef, symbolicLocationMask } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring, to_jsstring } = fengari;

export interface LuaDuelChainApiHostState {
  pushEffectTable: (state: unknown, id: number) => void;
  getEffectTypeFlags: (id: number) => number | undefined;
  changeChainOperation: (state: unknown, chainIndex: number, operationRef: number) => boolean;
  activeContext: DuelEffectContext | undefined;
}

export function installDuelChainApi(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.chain.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentChain"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.chain.length);
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
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsChainNegatable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session));
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
  else if (info === 15 || info === 19) lua.lua_pushinteger(L, cardTypeFlags(source));
  else if (info === 16) lua.lua_pushinteger(L, positionMaskFromPosition(source?.position));
  else if (info === 17) lua.lua_pushinteger(L, source ? Number(source.code) : 0);
  else if (info === 18) lua.lua_pushinteger(L, source?.data.alias ? Number(source.data.alias) : 0);
  else if (info === 20) lua.lua_pushinteger(L, source?.data.level ?? 0);
  else if (info === 21) lua.lua_pushinteger(L, cardRank(source));
  else if (info === 22) lua.lua_pushinteger(L, source?.data.attribute ?? 0);
  else if (info === 23) lua.lua_pushinteger(L, source?.data.race ?? 0);
  else if (info === 24) lua.lua_pushinteger(L, source?.data.attack ?? 0);
  else if (info === 25) lua.lua_pushinteger(L, source?.data.defense ?? 0);
  else if (info === 26) lua.lua_pushinteger(L, 0);
  else if (info === 27) lua.lua_pushinteger(L, source?.summonType ? locationMaskFromLocation(source.previousLocation) : 0);
  else if (info === 28) lua.lua_pushinteger(L, summonTypeMask(source));
  else if (info === 29) lua.lua_pushboolean(L, Boolean(source?.summonType));
  else if (info === 30) pushGroupTable(L, []);
  else if (info === 31 && source) pushCardTable(L, source.uid);
  else lua.lua_pushnil(L);
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
  const registryKey = knownLuaChainLimitRegistryKey(L, hostState.activeContext, untilChainEnd) ?? luaChainLimitRegistryKey(hostState.activeContext, untilChainEnd, filterRef);
  addDuelChainLimit(session.state, {
    ...(registryKey === undefined ? {} : { registryKey }),
    untilChainEnd,
    allows: (effect, player, chainPlayer) => callChainLimit(L, hostState, filterRef, effect, player, chainPlayer),
    release: () => releaseOptionalFunctionRef(L, filterRef),
  });
  return 0;
}

function knownLuaChainLimitRegistryKey(L: unknown, ctx: DuelEffectContext | undefined, untilChainEnd: boolean): string | undefined {
  if (!ctx?.source.code) return undefined;
  const known = knownLuaChainLimitPredicate(L, 1);
  return known ? `lua-chain-limit:${ctx.source.code}:${ctx.player}:${untilChainEnd ? "chain" : "link"}:known:${known}` : undefined;
}

function knownLuaChainLimitPredicate(L: unknown, index: number): string | undefined {
  if (isGlobalTableFunction(L, index, "aux", "FALSE")) return "aux.FALSE";
  if (isGlobalTableFunction(L, index, "aux", "TRUE")) return "aux.TRUE";
  const cardTableField = matchingGlobalCardTableFunctionField(L, index);
  if (cardTableField) return cardTableField;
  const cardUid = singleCapturedCardUid(L, index);
  if (cardUid) return `closure:card-not-handler:${cardUid}`;
  const typeMask = capturedTypeMask(L, index);
  if (typeMask !== undefined) return `closure:type-mask-response-player:${typeMask}`;
  const chainPlayer = capturedChainPlayer(L, index);
  if (chainPlayer !== undefined) return `closure:chain-player:${chainPlayer}`;
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

function singleCapturedCardUid(L: unknown, index: number): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const cardUids: string[] = [];
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      const cardUid = readCardUid(L, -1);
      if (!cardUid) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      cardUids.push(cardUid);
    }
    lua.lua_pop(L, 1);
  }
  return cardUids.length === 1 ? cardUids[0] : undefined;
}

function capturedTypeMask(L: unknown, index: number): number | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const numbers: Array<{ name: string; value: number }> = [];
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (!lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      numbers.push({ name, value: lua.lua_tointeger(L, -1) });
    }
    lua.lua_pop(L, 1);
  }
  return numbers.length === 1 && isTypeMaskUpvalueName(numbers[0]!.name) ? numbers[0]!.value : undefined;
}

function isTypeMaskUpvalueName(name: string): boolean {
  return name === "typ" || name === "typeMask" || name === "type_mask";
}

function capturedChainPlayer(L: unknown, index: number): PlayerId | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const numbers: Array<{ name: string; value: number }> = [];
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) break;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    if (name !== "_ENV") {
      if (!lua.lua_isnumber(L, -1)) {
        lua.lua_pop(L, 1);
        return undefined;
      }
      numbers.push({ name, value: lua.lua_tointeger(L, -1) });
    }
    lua.lua_pop(L, 1);
  }
  const captured = numbers.length === 1 && isChainPlayerUpvalueName(numbers[0]!.name) ? numbers[0]!.value : undefined;
  return captured === 0 || captured === 1 ? captured : undefined;
}

function isChainPlayerUpvalueName(name: string): boolean {
  return name === "chainPlayer" || name === "chain_player";
}

function luaChainLimitRegistryKey(ctx: DuelEffectContext | undefined, untilChainEnd: boolean, filterRef: number): string | undefined {
  if (!ctx?.source.code) return undefined;
  return `lua-chain-limit:${ctx.source.code}:${ctx.player}:${untilChainEnd ? "chain" : "link"}:${filterRef}`;
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
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushEffectByDuelId(L: unknown, hostState: LuaDuelChainApiHostState, effectId: string): void {
  const id = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
}

function pushIsChainNegatable(L: unknown, session: DuelSession): number {
  const target = chainLinkByLuaArg(L, session);
  lua.lua_pushboolean(L, Boolean(target && canNegateDuelChainLink(session.state, target.id)));
  return 1;
}

function pushNegateChainLink(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): number {
  const target = chainLinkByLuaArg(L, session);
  if (!target || target.negated) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const source = session.state.cards.find((candidate) => candidate.uid === target.sourceUid);
  const activeSource = hostState.activeContext?.source;
  lua.lua_pushboolean(L, negateDuelChainLink(
    session.state,
    target.id,
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
    negateDuelChainLink(session.state, link.id, player, cardName);
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
  lua.lua_pushboolean(L, Boolean(cardUid && link?.targetUids?.includes(cardUid)));
  return 1;
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

function chainLinkByLuaArg(L: unknown, session: DuelSession): DuelState["chain"][number] | undefined {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  return chainLinkByLuaIndex(session, requestedIndex);
}

function chainLinkByLuaIndex(session: DuelSession, requestedIndex: number, hostState?: LuaDuelChainApiHostState): DuelState["chain"][number] | undefined {
  if (requestedIndex <= 0) return hostState?.activeContext?.chainLink ?? session.state.chain[session.state.chain.length - 1];
  return session.state.chain[requestedIndex - 1];
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

function readLuaError(L: unknown): string {
  const message = lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return message;
}

function chainNumericId(link: DuelState["chain"][number]): number {
  const id = Number(link.id.match(/^chain-(\d+)$/)?.[1]);
  return Number.isFinite(id) ? id : 0;
}

function cardRank(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
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

function cardTypeFlags(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
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
