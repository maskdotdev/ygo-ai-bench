import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { isEffectDefeatPrevented } from "#duel/continuous-effects.js";
import { collectDuelTriggerEffects, damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/core.js";
import { clearEndedDuelPendingState } from "#duel/end-state.js";
import { duelReason } from "#duel/reasons.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import type { DuelSession, DuelWinner, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelLpApi(L: unknown, session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): void {
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
    if (session.state.status === "ended") return 0;
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
      if (value > 0) {
        const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
        markLuaOperationTimingBoundary(session, hostState);
        collectDuelTriggerEffects(session.state, "lifePointCostPaid", undefined, { eventPlayer: player, eventValue: value, ...luaEffectReasonPayload(hostState, duelReason.cost, reasonPlayer) });
        if (hostState.activeContext) hostState.activeOperationMoved = true;
      }
    }
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("PayLPCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const applied = damageDuelPlayer(session.state, player, value, reason);
    if (applied > 0 && session.state.status !== "ended") {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      markLuaOperationTimingBoundary(session, hostState);
      collectDuelTriggerEffects(session.state, "damageDealt", undefined, { eventPlayer: player, eventValue: applied, ...luaEffectReasonPayload(hostState, reason, reasonPlayer) });
      if (hostState.activeContext) hostState.activeOperationMoved = true;
    }
    lua.lua_pushinteger(state, applied);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const applied = recoverDuelPlayer(session.state, player, value);
    if (applied > 0) {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      markLuaOperationTimingBoundary(session, hostState);
      collectDuelTriggerEffects(session.state, "recoveredLifePoints", undefined, { eventPlayer: player, eventValue: applied, ...luaEffectReasonPayload(hostState, reason, reasonPlayer) });
      if (hostState.activeContext) hostState.activeOperationMoved = true;
    }
    lua.lua_pushinteger(state, applied);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Recover"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const winner = normalizeWinner(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const reason = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    if (winner !== "draw" && isEffectDefeatPrevented(session.state, otherPlayer(winner), createLuaMaterialCheckContext(session.state))) return 0;
    session.state.status = "ended";
    session.state.winner = winner;
    session.state.winReason = reason;
    clearEndedDuelPendingState(session.state);
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
