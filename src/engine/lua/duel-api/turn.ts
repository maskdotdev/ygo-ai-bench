import fengari from "fengari";
import type { DuelPhase, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelTurnApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turn);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushboolean(state, session.state.turnPlayer === player);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, phaseMask(session.state.phase));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const phase = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    lua.lua_pushboolean(state, (phaseMask(session.state.phase) & phase) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, session.state.phase === "main1" || session.state.phase === "main2");
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsMainPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, session.state.phase === "battle");
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, false);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageStep"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, false);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageCalculated"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const phases = phasesFromMask(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    const count = Math.max(1, lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 1);
    for (const phase of phases) skipPhase(session, player, phase, count);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SkipPhase"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function phaseMask(phase: DuelPhase): number {
  if (phase === "draw") return 0x1;
  if (phase === "standby") return 0x2;
  if (phase === "main1") return 0x4;
  if (phase === "battle") return 0x80;
  if (phase === "main2") return 0x100;
  return 0x200;
}

function phasesFromMask(mask: number): DuelPhase[] {
  const phases: DuelPhase[] = [];
  for (const phase of ["draw", "standby", "main1", "battle", "main2", "end"] satisfies DuelPhase[]) {
    if ((phaseMask(phase) & mask) !== 0) phases.push(phase);
  }
  return phases;
}

function skipPhase(session: DuelSession, player: PlayerId, phase: DuelPhase, count: number): void {
  const existing = session.state.skippedPhases.find((skip) => skip.player === player && skip.phase === phase);
  if (existing) existing.remaining = Math.max(existing.remaining, count);
  else session.state.skippedPhases.push({ player, phase, remaining: count });
}
