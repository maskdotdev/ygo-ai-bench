import fengari from "fengari";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelFlagEffectCount, getDuelFlagEffectLabel, registerDuelFlagEffect, resetDuelFlagEffect, setDuelFlagEffectLabel } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import { readCardUid } from "#lua/api-utils.js";
import { normalizeLuaUnsignedInteger } from "#lua/numeric-utils.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const flagDeckMaster = 153000000;

export function installCardFlagApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 3)) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const resetCount = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : undefined;
    const value = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : 0;
    if (!uid) {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code, reset, property, value, resetCount);
    lua.lua_pushinteger(state, getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    lua.lua_pushboolean(state, Boolean(uid && getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, code) >= minimum));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("HasFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? getDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, uid ? setDuelFlagEffectLabel(session.state, { ownerType: "card", ownerId: uid }, code, value) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const uid = readCardUid(state, 1);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, uid ? resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: uid }, code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: uid }, flagDeckMaster) > 0));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDeckMaster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    if (card) {
      card.uniqueOnField = {
        self: readBooleanFlag(state, 2),
        opponent: readBooleanFlag(state, 3),
        code: lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0,
        locationMask: lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 0x18,
      };
    }
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetUniqueOnField"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    if (!card) return 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : card.controller);
    clearDeckMaster(session, player);
    moveDuelCard(session.state, card.uid, "deck", player, duelReason.rule, player);
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: card.uid }, flagDeckMaster, 0, 0, 0);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("MoveToDeckMasterZone"));
}

function clearDeckMaster(session: DuelSession, player: PlayerId): void {
  for (const card of session.state.cards.filter((candidate) => candidate.controller === player && isDeckMaster(session, candidate))) {
    resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: card.uid }, flagDeckMaster);
  }
}

function isDeckMaster(session: DuelSession, card: DuelCardInstance): boolean {
  return getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: card.uid }, flagDeckMaster) > 0;
}

function readBooleanFlag(L: unknown, index: number): boolean {
  if (lua.lua_isnumber(L, index)) return lua.lua_tointeger(L, index) !== 0;
  return lua.lua_toboolean(L, index);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
