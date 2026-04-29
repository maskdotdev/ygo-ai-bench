import fengari from "fengari";
import { negateDuelChainLink } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelChainApiHostState {
  pushEffectTable: (state: unknown, id: number) => void;
  activeContext: DuelEffectContext | undefined;
}

export function installDuelChainApi(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.chain.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentChain"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainInfo(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsChainNegatable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session));
  lua.lua_setfield(L, -2, to_luastring("NegateActivation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session));
  lua.lua_setfield(L, -2, to_luastring("NegateEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeTargetPlayer(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeTargetPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeTargetParam(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeTargetParam"));
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

function pushChainInfoValue(L: unknown, session: DuelSession, hostState: LuaDuelChainApiHostState, link: DuelState["chain"][number], info: number): void {
  const source = session.state.cards.find((card) => card.uid === link.sourceUid);
  if (info === 0x1) {
    const id = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
    if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
    else lua.lua_pushnil(L);
  }
  else if (info === 0x2 || info === 0x4) lua.lua_pushinteger(L, link.player);
  else if (info === 0x8) lua.lua_pushinteger(L, locationMaskFromLocation(source?.location));
  else if (info === 0x10 && source) pushCardTable(L, source.uid);
  else if (info === 0x20) lua.lua_pushinteger(L, link.activationSequence ?? source?.sequence ?? 0);
  else if (info === 0x40) pushGroupTable(L, link.targetUids ?? []);
  else if (info === 0x80 && link.targetPlayer !== undefined) lua.lua_pushinteger(L, link.targetPlayer);
  else if (info === 0x100 && link.targetParam !== undefined) lua.lua_pushinteger(L, link.targetParam);
  else lua.lua_pushnil(L);
}

function pushIsChainNegatable(L: unknown, session: DuelSession): number {
  const target = chainLinkByLuaArg(L, session);
  lua.lua_pushboolean(L, Boolean(target && !target.negated));
  return 1;
}

function pushNegateChainLink(L: unknown, session: DuelSession): number {
  const target = chainLinkByLuaArg(L, session);
  if (!target || target.negated) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const source = session.state.cards.find((candidate) => candidate.uid === target.sourceUid);
  lua.lua_pushboolean(L, negateDuelChainLink(session.state, target.id, source?.controller ?? session.state.turnPlayer, source?.name ?? "Lua effect"));
  return 1;
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
