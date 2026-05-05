import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { collectDuelTriggerEffects, raiseDuelEvent } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createRng } from "#engine/rng.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelRandomApi(L: unknown, session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushTossDice(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("TossDice"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetDiceResult(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetDiceResult"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetDiceResult(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetDiceResult"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTossCoin(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("TossCoin"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCoinResult(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCoinResult"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetCoinResult(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetCoinResult"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceCoin(state));
  lua.lua_setfield(L, -2, to_luastring("AnnounceCoin"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCallCoin(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CallCoin"));
  lua.lua_pushcfunction(L, pushCountHeads);
  lua.lua_setfield(L, -2, to_luastring("CountHeads"));
  lua.lua_pushcfunction(L, pushCountTails);
  lua.lua_setfield(L, -2, to_luastring("CountTails"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetRandomNumber(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetRandomNumber"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRockPaperScissors(state, session));
  lua.lua_setfield(L, -2, to_luastring("RockPaperScissors"));
}

function pushTossDice(L: unknown, session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): number {
  if (session.state.status === "ended") return 0;
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const count = Math.max(1, Math.trunc(lua.lua_isnumber(L, 2) ? lua.lua_tonumber(L, 2) : 1));
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) {
    results.push(rollDie(session));
  }
  session.state.lastDiceResults = results;
  pushDuelLog(session.state, "tossDice", player === 1 ? 1 : 0, undefined, results.join(","));
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  markLuaOperationTimingBoundary(session, hostState);
  collectDuelTriggerEffects(session.state, "diceTossed", undefined, { eventPlayer: normalizePlayer(player), eventValue: results.length, eventReason: duelReason.effect, eventReasonPlayer: reasonPlayer });
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  for (const result of results) lua.lua_pushinteger(L, result);
  return results.length;
}

function pushGetDiceResult(L: unknown, session: DuelSession): number {
  for (const result of session.state.lastDiceResults) lua.lua_pushinteger(L, result);
  return session.state.lastDiceResults.length;
}

function pushSetDiceResult(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  session.state.lastDiceResults = readIntegerResults(L).map((result) => Math.min(6, Math.max(1, result)));
  return 0;
}

function rollDie(session: DuelSession): number {
  const rng = createRng(`${session.state.seed}:dice:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  return Math.floor(rng() * 6) + 1;
}

function pushTossCoin(L: unknown, session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): number {
  if (session.state.status === "ended") return 0;
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const count = Math.max(1, Math.trunc(lua.lua_isnumber(L, 2) ? lua.lua_tonumber(L, 2) : 1));
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) results.push(tossCoin(session));
  session.state.lastCoinResults = results;
  pushDuelLog(session.state, "tossCoin", player === 1 ? 1 : 0, undefined, results.join(","));
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  markLuaOperationTimingBoundary(session, hostState);
  collectDuelTriggerEffects(session.state, "coinTossed", undefined, { eventPlayer: normalizePlayer(player), eventValue: results.length, eventReason: duelReason.effect, eventReasonPlayer: reasonPlayer });
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  for (const result of results) lua.lua_pushinteger(L, result);
  return results.length;
}

function pushGetCoinResult(L: unknown, session: DuelSession): number {
  for (const result of session.state.lastCoinResults) lua.lua_pushinteger(L, result);
  return session.state.lastCoinResults.length;
}

function pushSetCoinResult(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  session.state.lastCoinResults = readIntegerResults(L).map((result) => result === 0 ? 0 : 1);
  return 0;
}

function pushAnnounceCoin(L: unknown): number {
  lua.lua_pushinteger(L, 1);
  return 1;
}

function pushCallCoin(L: unknown, session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const call = announceCoin();
  const result = tossCoin(session);
  session.state.lastCoinResults = [result];
  pushDuelLog(session.state, "callCoin", player === 1 ? 1 : 0, undefined, `${call}/${result}`);
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  markLuaOperationTimingBoundary(session, hostState);
  collectDuelTriggerEffects(session.state, "coinTossed", undefined, { eventPlayer: normalizePlayer(player), eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: reasonPlayer });
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  lua.lua_pushboolean(L, call === result);
  return 1;
}

function tossCoin(session: DuelSession): number {
  const rng = createRng(`${session.state.seed}:coin:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  return rng() < 0.5 ? 0 : 1;
}

function announceCoin(): number {
  return 1;
}

function pushCountHeads(L: unknown): number {
  let count = 0;
  for (let index = 1; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index) && lua.lua_tointeger(L, index) === 1) count += 1;
  }
  lua.lua_pushinteger(L, count);
  return 1;
}

function pushCountTails(L: unknown): number {
  let count = 0;
  for (let index = 1; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index) && lua.lua_tointeger(L, index) === 0) count += 1;
  }
  lua.lua_pushinteger(L, count);
  return 1;
}

function normalizePlayer(player: number): PlayerId {
  return player === 1 ? 1 : 0;
}

function readIntegerResults(L: unknown): number[] {
  const results: number[] = [];
  for (let index = 1; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) results.push(Math.trunc(lua.lua_tonumber(L, index)));
  }
  return results;
}

function pushGetRandomNumber(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const first = lua.lua_isnumber(L, 1) ? Math.trunc(lua.lua_tonumber(L, 1)) : 0;
  const second = lua.lua_isnumber(L, 2) ? Math.trunc(lua.lua_tonumber(L, 2)) : first;
  const min = Math.min(first, second);
  const max = Math.max(first, second);
  lua.lua_pushinteger(L, randomInteger(session, min, max));
  return 1;
}

function randomInteger(session: DuelSession, min: number, max: number): number {
  const rng = createRng(`${session.state.seed}:number:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pushRockPaperScissors(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, session.state.turnPlayer);
    return 1;
  }
  const winner: PlayerId = randomInteger(session, 0, 1) === 1 ? 1 : 0;
  pushDuelLog(session.state, "rockPaperScissors", winner, undefined, String(lua.lua_toboolean(L, 1)));
  lua.lua_pushinteger(L, winner);
  return 1;
}
