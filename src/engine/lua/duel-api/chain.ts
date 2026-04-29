import fengari from "fengari";
import { negateDuelChainLink } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid } from "#lua/api-utils.js";
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
  lua.lua_pushcfunction(L, (state: unknown) => pushChainEvent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainEvent"));
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
  else if (info === 0x4000) lua.lua_pushinteger(L, positionMaskFromPosition(source?.position));
  else if (info === 0x8000) lua.lua_pushinteger(L, source ? Number(source.code) : 0);
  else if (info === 0x10000) lua.lua_pushinteger(L, source?.data.alias ? Number(source.data.alias) : 0);
  else if (info === 0x40000) lua.lua_pushinteger(L, source?.data.level ?? 0);
  else if (info === 0x80000) lua.lua_pushinteger(L, cardRank(source));
  else if (info === 0x100000) lua.lua_pushinteger(L, source?.data.attribute ?? 0);
  else if (info === 0x200000) lua.lua_pushinteger(L, source?.data.race ?? 0);
  else if (info === 0x400000) lua.lua_pushinteger(L, source?.data.attack ?? 0);
  else if (info === 0x800000) lua.lua_pushinteger(L, source?.data.defense ?? 0);
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
  pushGroupTable(L, eventCard ? [eventCard.uid] : []);
  lua.lua_pushinteger(L, eventCard?.controller ?? link.player);
  lua.lua_pushinteger(L, 0);
  lua.lua_pushnil(L);
  lua.lua_pushinteger(L, eventCard?.reason ?? 0);
  lua.lua_pushinteger(L, eventCard?.controller ?? link.player);
  return 6;
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

function cardRank(card: DuelCardInstance | undefined): number {
  return card && (cardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
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
