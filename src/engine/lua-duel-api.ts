import fengari from "fengari";
import { negateDuelChainLink } from "./duel-core.js";
import { getDuelFlagEffectCount, registerDuelFlagEffect, resetDuelFlagEffect } from "./duel-flags.js";
import { pushCardTable } from "./lua-card-api.js";
import { duelReason } from "./duel-reasons.js";
import { installDuelActivityApi } from "./lua-duel-activity-api.js";
import { installDuelDeckApi } from "./lua-duel-deck-api.js";
import { installDuelLpApi } from "./lua-duel-lp-api.js";
import { installDuelMoveApi } from "./lua-duel-move-api.js";
import { installDuelPlayerApi } from "./lua-duel-player-api.js";
import { installDuelQueryApi } from "./lua-duel-query-api.js";
import { installDuelReleaseApi } from "./lua-duel-release-api.js";
import { installDuelSummonApi } from "./lua-duel-summon-api.js";
import { installDuelTurnApi } from "./lua-duel-turn-api.js";
import { pushGroupTable } from "./lua-group-api.js";
import { readCardUid, readGroupUids } from "./lua-api-utils.js";
import type { DuelCardInstance, DuelSession, DuelState, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
  operationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
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

export function installDuelApi(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_newtable(L);
  installDuelTurnApi(L, session);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    hostState.messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("Hint"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, lua.lua_gettop(state) >= 2 ? 0 : -1);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectOption"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectYesNo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceNumber"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceType"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceRace"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAttribute"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.chain.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentChain"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChainInfo(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetChainInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const attackerUid = session.state.currentAttack?.attackerUid;
    if (!attackerUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, attackerUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttacker"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const targetUid = session.state.currentAttack?.targetUid;
    if (!targetUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, targetUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttackTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsChainNegatable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsChainNegatable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session));
  lua.lua_setfield(L, -2, to_luastring("NegateActivation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateChainLink(state, session));
  lua.lua_setfield(L, -2, to_luastring("NegateEffect"));
  installDuelActivityApi(L, session);
  installDuelLpApi(L, session);
  installDuelDeckApi(L, session, hostState);
  installDuelPlayerApi(L, session);
  installDuelMoveApi(L, session, hostState);
  installDuelSummonApi(L, session, hostState);
  installDuelQueryApi(L, session, hostState);
  installDuelReleaseApi(L, session);
  installOperationInfoHelpers(L, hostState);
  installFlagHelpers(L, session);
  lua.lua_setglobal(L, to_luastring("Duel"));
}

function pushFirstAnnouncementValue(L: unknown, fallback: number): number {
  const value = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : fallback;
  lua.lua_pushinteger(L, value);
  return 1;
}

function installFlagHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const value = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0;
    registerDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code, reset, property, value);
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, resetDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}

function pushChainInfo(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): number {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const chainIndex = requestedIndex <= 0 ? session.state.chain.length - 1 : requestedIndex - 1;
  const link = session.state.chain[chainIndex];
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

function pushChainInfoValue(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState, link: DuelState["chain"][number], info: number): void {
  const source = session.state.cards.find((card) => card.uid === link.sourceUid);
  if (info === 0x1) {
    const id = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
    if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
    else lua.lua_pushnil(L);
  }
  else if (info === 0x2 || info === 0x4) lua.lua_pushinteger(L, link.player);
  else if (info === 0x8) lua.lua_pushinteger(L, locationMaskFromLocation(source?.location));
  else if (info === 0x10 && source) pushCardTable(L, source.uid);
  else if (info === 0x20) pushGroupTable(L, link.targetUids ?? []);
  else lua.lua_pushnil(L);
}

function pushIsChainNegatable(L: unknown, session: DuelSession): number {
  const target = chainLinkByLuaIndex(L, session);
  lua.lua_pushboolean(L, Boolean(target && !target.negated));
  return 1;
}

function pushNegateChainLink(L: unknown, session: DuelSession): number {
  const target = chainLinkByLuaIndex(L, session);
  if (!target || target.negated) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const source = session.state.cards.find((candidate) => candidate.uid === target.sourceUid);
  lua.lua_pushboolean(L, negateDuelChainLink(session.state, target.id, source?.controller ?? session.state.turnPlayer, source?.name ?? "Lua effect"));
  return 1;
}

function chainLinkByLuaIndex(L: unknown, session: DuelSession): DuelState["chain"][number] | undefined {
  const requestedIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.chain.length;
  const chainIndex = requestedIndex <= 0 ? session.state.chain.length - 1 : requestedIndex - 1;
  return session.state.chain[chainIndex];
}

function installOperationInfoHelpers(L: unknown, hostState: LuaDuelApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const info: LuaDuelOperationInfo = {
      chainIndex: lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0,
      category: lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0,
      targetUids: readCardOrGroupUids(state, 3),
      count: lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0,
      player: readOptionalPlayer(state, 5) ?? 0,
      parameter: lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : 0,
    };
    const existingIndex = hostState.operationInfos.findIndex((candidate) => candidate.chainIndex === info.chainIndex && candidate.category === info.category);
    if (existingIndex >= 0) hostState.operationInfos[existingIndex] = info;
    else hostState.operationInfos.push(info);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const chainIndex = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const category = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const info = findOperationInfo(hostState.operationInfos, chainIndex, category);
    if (!info) {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    lua.lua_pushboolean(state, true);
    lua.lua_pushinteger(state, info.category);
    pushGroupTable(state, info.targetUids);
    lua.lua_pushinteger(state, info.count);
    lua.lua_pushinteger(state, info.player);
    lua.lua_pushinteger(state, info.parameter);
    return 6;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperationInfo"));
}

function findOperationInfo(operationInfos: LuaDuelOperationInfo[], chainIndex: number, category: number): LuaDuelOperationInfo | undefined {
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate) continue;
    if (candidate.chainIndex === chainIndex && candidate.category === category) return candidate;
  }
  return undefined;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
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

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
