import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { isEffectDefeatPrevented } from "#duel/continuous-effects.js";
import { damageDuelPlayer, raiseDuelEvent, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import type { DuelSession, DuelWinner, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelLpApi(L: unknown, session: DuelSession): void {
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
    const value = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    lua.lua_pushboolean(state, session.state.players[player].lifePoints > value);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckLPCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    if (session.state.players[player].lifePoints > value) {
      setDuelPlayerLifePoints(session.state, player, session.state.players[player].lifePoints - value);
      if (value > 0) raiseDuelEvent(session.state, "lifePointCostPaid");
    }
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("PayLPCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const applied = damageDuelPlayer(session.state, player, value, reason);
    if (applied > 0) raiseDuelEvent(session.state, "damageDealt");
    lua.lua_pushinteger(state, applied);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const applied = recoverDuelPlayer(session.state, player, value);
    if (applied > 0) raiseDuelEvent(session.state, "recoveredLifePoints");
    lua.lua_pushinteger(state, applied);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Recover"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const winner = normalizeWinner(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const reason = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    if (winner !== "draw" && isEffectDefeatPrevented(session.state, otherPlayer(winner), createLuaMaterialCheckContext(session.state))) return 0;
    session.state.status = "ended";
    session.state.winner = winner;
    session.state.winReason = reason;
    session.state.chain = [];
    session.state.pendingTriggers = [];
    delete session.state.prompt;
    delete session.state.waitingFor;
    pushDuelLog(session.state, "win", winner === "draw" ? undefined : winner, undefined, String(reason));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Win"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("RDComplete"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function normalizeWinner(value: number): DuelWinner {
  if (value === 2) return "draw";
  return normalizePlayer(value);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
