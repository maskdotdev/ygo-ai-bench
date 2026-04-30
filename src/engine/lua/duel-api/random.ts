import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { createRng } from "#engine/rng.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelRandomApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushTossDice(state, session));
  lua.lua_setfield(L, -2, to_luastring("TossDice"));
  lua.lua_pushcfunction(L, (state: unknown) => pushTossCoin(state, session));
  lua.lua_setfield(L, -2, to_luastring("TossCoin"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceCoin(state));
  lua.lua_setfield(L, -2, to_luastring("AnnounceCoin"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCallCoin(state, session));
  lua.lua_setfield(L, -2, to_luastring("CallCoin"));
  lua.lua_pushcfunction(L, pushCountHeads);
  lua.lua_setfield(L, -2, to_luastring("CountHeads"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetRandomNumber(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetRandomNumber"));
}

function pushTossDice(L: unknown, session: DuelSession): number {
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const count = Math.max(1, Math.trunc(lua.lua_isnumber(L, 2) ? lua.lua_tonumber(L, 2) : 1));
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) {
    results.push(rollDie(session));
  }
  pushDuelLog(session.state, "tossDice", player === 1 ? 1 : 0, undefined, results.join(","));
  for (const result of results) lua.lua_pushinteger(L, result);
  return results.length;
}

function rollDie(session: DuelSession): number {
  const rng = createRng(`${session.state.seed}:dice:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  return Math.floor(rng() * 6) + 1;
}

function pushTossCoin(L: unknown, session: DuelSession): number {
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const count = Math.max(1, Math.trunc(lua.lua_isnumber(L, 2) ? lua.lua_tonumber(L, 2) : 1));
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) results.push(tossCoin(session));
  pushDuelLog(session.state, "tossCoin", player === 1 ? 1 : 0, undefined, results.join(","));
  for (const result of results) lua.lua_pushinteger(L, result);
  return results.length;
}

function pushAnnounceCoin(L: unknown): number {
  lua.lua_pushinteger(L, 1);
  return 1;
}

function pushCallCoin(L: unknown, session: DuelSession): number {
  const player = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer;
  const call = announceCoin();
  const result = tossCoin(session);
  pushDuelLog(session.state, "callCoin", player === 1 ? 1 : 0, undefined, `${call}/${result}`);
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

function pushGetRandomNumber(L: unknown, session: DuelSession): number {
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
