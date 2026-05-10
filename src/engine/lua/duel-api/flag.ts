import fengari from "fengari";
import { specialSummonDuelCard } from "#duel/core.js";
import { getDuelFlagEffectCount, getDuelFlagEffectLabel, registerDuelFlagEffect, resetDuelFlagEffect, setDuelFlagEffectLabel } from "#duel/flags.js";
import { pushCardTable } from "#lua/card-api.js";
import { normalizeLuaUnsignedInteger } from "#lua/numeric-utils.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const flagDeckMaster = 153000000;

export function installDuelFlagApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const mask = lua.lua_isnumber(state, 1) ? normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 1)) : 0;
    lua.lua_pushboolean(state, hasAllFlags(session.state.duelTypeFlags, mask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDuelType"));
  lua.lua_pushcfunction(L, () => {
    if (session.state.status === "ended") return 0;
    session.state.unofficialProcEnabled = true;
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("EnableUnofficialProc"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    const deckMaster = findDeckMaster(session, player);
    lua.lua_pushboolean(state, Boolean(deckMaster && code !== undefined && deckMaster.code === code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDeckMaster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const deckMaster = findDeckMaster(session, player);
    if (deckMaster) pushCardTable(state, deckMaster.uid);
    else lua.lua_pushnil(state);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDeckMaster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, clearDeckMaster(session, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ClearDeckMasterZone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, summonDeckMaster(session, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SummonDeckMaster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const flag = lua.lua_isnumber(state, 1) ? Math.trunc(lua.lua_tonumber(state, 1)) : 0;
    if (flag > 0) session.state.globalFlags = Number(BigInt(session.state.globalFlags) | BigInt(flag));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("EnableGlobalFlag"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reset = lua.lua_isnumber(state, 3) ? normalizeLuaUnsignedInteger(lua.lua_tonumber(state, 3)) : 0;
    const property = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const resetCount = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : undefined;
    const value = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : 0;
    registerDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code, reset, property, value, resetCount);
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
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    lua.lua_pushboolean(state, getDuelFlagEffectCount(session.state, { ownerType: "player", ownerId: player }, code) >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("HasFlagEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, getDuelFlagEffectLabel(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const value = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, setDuelFlagEffectLabel(session.state, { ownerType: "player", ownerId: player }, code, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SetFlagEffectLabel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, resetDuelFlagEffect(session.state, { ownerType: "player", ownerId: player }, code));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ResetFlagEffect"));
}

function hasAllFlags(flags: number, mask: number): boolean {
  if (!Number.isFinite(flags) || !Number.isFinite(mask) || mask <= 0) return false;
  return (BigInt(Math.trunc(flags)) & BigInt(Math.trunc(mask))) === BigInt(Math.trunc(mask));
}

function findDeckMaster(session: DuelSession, player: PlayerId): { uid: string; code: string; controller: PlayerId; location: string } | undefined {
  return session.state.cards.find(
    (card) => card.controller === player && getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: card.uid }, flagDeckMaster) > 0,
  );
}

function clearDeckMaster(session: DuelSession, player: PlayerId): number {
  const deckMaster = findDeckMaster(session, player);
  return deckMaster ? resetDuelFlagEffect(session.state, { ownerType: "card", ownerId: deckMaster.uid }, flagDeckMaster) : 0;
}

function summonDeckMaster(session: DuelSession, player: PlayerId): number {
  const deckMaster = findDeckMaster(session, player);
  if (!deckMaster) return 0;
  try {
    clearDeckMaster(session, player);
    const summoned = deckMaster.location === "monsterZone" ? deckMaster : specialSummonDuelCard(session.state, deckMaster.uid, player);
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: summoned.uid }, flagDeckMaster, 0, 0, 0);
    return 1;
  } catch {
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: deckMaster.uid }, flagDeckMaster, 0, 0, 0);
    return 0;
  }
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
