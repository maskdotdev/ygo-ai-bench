import fengari from "fengari";
import {
  banishDuelCard,
  changeDuelCardPosition,
  canMoveDuelCardToLocation,
  damageDuelPlayer,
  drawDuelCards,
  destroyDuelCard,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  negateDuelChainLink,
  recoverDuelPlayer,
  ritualSummonDuelCard,
  sendDuelCardToGraveyard,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  synchroSummonDuelCard,
  moveDuelCard,
  xyzSummonDuelCard,
} from "./duel-core.js";
import { getDuelFlagEffectCount, registerDuelFlagEffect, resetDuelFlagEffect } from "./duel-flags.js";
import { pushCardTable } from "./lua-card-api.js";
import { duelReason } from "./duel-reasons.js";
import { pushGroupTable } from "./lua-group-api.js";
import {
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readGroupUids,
  readOptionalFunctionRef,
  releaseOptionalFunctionRef,
} from "./lua-api-utils.js";
import { shuffle } from "./rng.js";
import type { CardPosition, DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

type LuaCardMover = (state: DuelState, uid: string, controller?: PlayerId, reason?: number) => DuelCardInstance;
type LuaFilterArgs = { start: number; count: number };

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
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushliteral(state, session.state.phase);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
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
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, session.state.players[player].lifePoints);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    setDuelPlayerLifePoints(session.state, player, value);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, damageDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, recoverDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Recover"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, topDeckUids(session, player, count).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDraw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    const drawUids = topDeckUids(session, player, count);
    const drawn = drawDuelCards(session.state, player, count, "Lua draw");
    setOperatedUids(hostState, drawUids.slice(0, drawn));
    lua.lua_pushinteger(state, drawn);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Draw"));
  installMoveHelpers(L, session, hostState);
  installSummonHelpers(L, session, hostState);
  installQueryHelpers(L, session, hostState);
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

function installMoveHelpers(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, sendDuelCardToGraveyard);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoGrave"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, destroyDuelCard, duelReason.destroy);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Destroy"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, banishDuelCard);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Remove"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, sendDuelCardToGraveyard, duelReason.release);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Release"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroupToLocation(session, state, "hand", 3);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroupToLocation(session, state, "deck", 4);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroupToLocation(session, state, "extraDeck", 3);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoExtraP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    const targetPlayer = readOptionalPlayer(state, 4);
    const requestedPosition = lua.lua_isnumber(state, 7) ? positionFromMask(lua.lua_tointeger(state, 7)) : undefined;
    const moved: string[] = [];
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        const summoned = specialSummonDuelCard(session.state, uid, targetPlayer ?? card.controller);
        if (requestedPosition) applySummonPosition(summoned, requestedPosition);
        moved.push(uid);
      } catch {
        // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
      }
    }
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    if (!requestedPosition) {
      setOperatedUids(hostState, []);
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const changed: string[] = [];
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        changeDuelCardPosition(session.state, card.controller, uid, requestedPosition);
        changed.push(uid);
      } catch {
        // EDOPro-style helpers report the number of changed cards; illegal changes simply fail.
      }
    }
    setOperatedUids(hostState, changed);
    lua.lua_pushinteger(state, changed.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangePosition"));
}

function installSummonHelpers(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, "FusionSummon"));
  lua.lua_setfield(L, -2, to_luastring("FusionSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, "SynchroSummon"));
  lua.lua_setfield(L, -2, to_luastring("SynchroSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, "XyzSummon"));
  lua.lua_setfield(L, -2, to_luastring("XyzSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, "LinkSummon"));
  lua.lua_setfield(L, -2, to_luastring("LinkSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, "RitualSummon"));
  lua.lua_setfield(L, -2, to_luastring("RitualSummon"));
}

function installQueryHelpers(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const excluded = readCardUid(state, 5);
    const uids = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded, readFilterArgs(state, 6));
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const excluded = readCardUid(state, 5);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded, readFilterArgs(state, 6)).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const opponentMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    pushGroupTable(state, fieldGroupUids(session, player, selfMask, opponentMask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const opponentMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, fieldGroupUids(session, player, selfMask, opponentMask).length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const sequence = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const uid = fieldCardUid(session, player, locationMask, sequence);
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFieldCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const minimum = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const excluded = readCardUid(state, 6);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded, readFilterArgs(state, 7)).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, count >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsExistingMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const excluded = readCardUid(state, 5);
    const uid = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded, readFilterArgs(state, 6))[0];
    releaseOptionalFunctionRef(state, filterRef);
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFirstMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, availableLocationCount(session, player, locationMask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, availableMonsterZoneCount(session, player, readCardOrGroupUids(state, 2)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMZoneCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const positionMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0x1;
    lua.lua_pushinteger(state, positionMaskFromPosition(positionFromMask(positionMask) ?? "faceUpAttack"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectPosition"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    pushGroupTable(state, topDeckUids(session, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDecktopGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const confirmed = readCardOrGroupUids(state, 2)
      .map((uid) => session.state.cards.find((card) => card.uid === uid)?.code)
      .filter((code): code is string => Boolean(code));
    hostState.messages.push(`confirmed ${player}: ${confirmed.join(",")}`);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleDeck(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const excluded = readCardUid(state, 4);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, 0x04, 0, excluded, readFilterArgs(state, 5)).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, count >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const min = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const max = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : min;
    const excluded = readCardUid(state, 5);
    const uids = matchingCardUidsWithFilter(state, session, filterRef, player, 0x04, 0, excluded, readFilterArgs(state, 6));
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids.slice(0, max > 0 ? max : Math.max(min, 1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session, hostState.activeTargetUids));
  lua.lua_setfield(L, -2, to_luastring("SelectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const target = hostState.activeTargetUids?.[0];
    if (!target) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, target);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFirstTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.activeTargetUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTargetCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.operatedUids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperatedGroup"));
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

function moveCardOrGroup(session: DuelSession, L: unknown, mover: LuaCardMover, extraReason = 0): string[] {
  const reason = readMoveReason(L, 2, extraReason);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      mover(session.state, uid, card.controller, reason);
      moved.push(uid);
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
  return moved;
}

function moveCardOrGroupToLocation(session: DuelSession, L: unknown, location: DuelLocation, reasonIndex: number): string[] {
  const reason = readMoveReason(L, reasonIndex, 0);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || !canMoveDuelCardToLocation(session.state, uid, location)) continue;
    moveDuelCard(session.state, uid, location, readOptionalPlayer(L, 2) ?? card.controller, reason);
    moved.push(uid);
  }
  return moved;
}

function readMoveReason(L: unknown, index: number, extraReason: number): number | undefined {
  const reason = lua.lua_isnumber(L, index) ? lua.lua_tointeger(L, index) : undefined;
  if (reason === undefined && extraReason === 0) return undefined;
  return (reason ?? 0) | extraReason;
}

function applySummonPosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
}

function pushLuaSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState, summonType: "FusionSummon" | "SynchroSummon" | "XyzSummon" | "LinkSummon" | "RitualSummon"): number {
  const targetUid = readCardUid(L, 1);
  const materialUids = readCardOrGroupUids(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  try {
    if (summonType === "FusionSummon") fusionSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "SynchroSummon") synchroSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "XyzSummon") xyzSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "LinkSummon") linkSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else ritualSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    setOperatedUids(hostState, [target.uid]);
    lua.lua_pushinteger(L, 1);
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
  }
  return 1;
}

function setOperatedUids(hostState: LuaDuelApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushSelectedMatchingGroup(L: unknown, session: DuelSession, targetUids?: string[]): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0;
  const opponentMask = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const excluded = readCardUid(L, 8);
  const uids = matchingCardUidsWithFilter(L, session, filterRef, player, selfMask, opponentMask, excluded, readFilterArgs(L, 9));
  releaseOptionalFunctionRef(L, filterRef);
  const limit = max > 0 ? max : Math.max(min, 1);
  const selected = uids.slice(0, limit);
  if (targetUids) targetUids.splice(0, targetUids.length, ...selected);
  pushGroupTable(L, selected);
  return 1;
}

function matchingCardUidsWithFilter(
  L: unknown,
  session: DuelSession,
  filterRef: number | undefined,
  player: PlayerId,
  selfMask: number,
  opponentMask: number,
  excluded: string | undefined,
  args: LuaFilterArgs,
): string[] {
  return fieldGroupUids(session, player, selfMask, opponentMask).filter((uid) => uid !== excluded && cardMatchesFilter(L, uid, filterRef, args));
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  const top = lua.lua_gettop(L);
  return { start, count: Math.max(0, top - start + 1) };
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function fieldCardUid(session: DuelSession, player: PlayerId, locationMask: number, sequence: number): string | undefined {
  return matchingCardUids(session, player, locationMask)[sequence];
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

function availableLocationCount(session: DuelSession, player: PlayerId, locationMask: number): number {
  const locations = locationsFromMask(locationMask);
  if (locations.includes("monsterZone")) return availableMonsterZoneCount(session, player, []);
  if (locations.includes("spellTrapZone")) return Math.max(0, 5 - matchingCardUids(session, player, 0x08).length);
  return 99;
}

function availableMonsterZoneCount(session: DuelSession, player: PlayerId, excludedUids: string[]): number {
  const occupied = session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone" && !excludedUids.includes(card.uid)).length;
  return Math.max(0, 5 - occupied);
}

function topDeckUids(session: DuelSession, player: PlayerId, count: number): string[] {
  return matchingCardUids(session, player, 0x01).slice(0, count);
}

function shuffleDeck(session: DuelSession, player: PlayerId): void {
  const deckCards = session.state.cards.filter((card) => card.controller === player && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(deckCards, `${session.state.seed}:lua-shuffle:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function positionMaskFromPosition(position: CardPosition): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
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
