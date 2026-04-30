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

function tossCoin(session: DuelSession): number {
  const rng = createRng(`${session.state.seed}:coin:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  return rng() < 0.5 ? 0 : 1;
}
