import fengari from "fengari";
import { isBattleAttackStep, isBattleDamageCalculation, isBattleDamageStep } from "#duel/battle-window-state.js";
import { isPhaseEntryPrevented } from "#duel/continuous-effects.js";
import { currentDuelPhaseMask, isBattleEndPhase, isBattleStartPhase, phaseMask } from "#duel/phase-mask.js";
import { nextAvailableDuelPhase } from "#duel/turn-flow.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelPhase, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelTurnApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushinteger(state, player === undefined ? session.state.turn : playerTurnCount(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, 5);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMasterRule"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushboolean(state, session.state.turnPlayer === player);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, currentDuelPhaseMask(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const phase = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    lua.lua_pushboolean(state, (currentDuelPhaseMask(session.state) & phase) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPhase"));
  pushPhasePredicate(L, "IsDrawPhase", session, (state) => state.phase === "draw");
  pushPhasePredicate(L, "IsStandbyPhase", session, (state) => state.phase === "standby");
  pushPhasePredicate(L, "IsMainPhase1", session, (state) => state.phase === "main1");
  pushPhasePredicate(L, "IsStartOfBattlePhase", session, isBattleStartPhase);
  pushPhasePredicate(L, "IsStartStep", session, isBattleStartPhase);
  pushPhasePredicate(L, "IsBattleStep", session, (state) => state.phase === "battle" && isBattleAttackStep(state));
  pushPhasePredicate(L, "IsEndOfBattlePhase", session, isBattleEndPhase);
  pushPhasePredicate(L, "IsEndPhase", session, (state) => state.phase === "end");
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, (session.state.phase === "main1" || session.state.phase === "main2") && (player === undefined || session.state.turnPlayer === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsMainPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, session.state.phase === "main2" && (player === undefined || session.state.turnPlayer === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsMainPhase2"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, session.state.phase === "battle" && matchesTurnPlayer(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, isAbleToEnterBattlePhase(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToEnterBP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, isBattleDamageStep(session.state) && matchesTurnPlayer(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageStep"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, isBattleDamageCalculation(session.state) && matchesTurnPlayer(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageCalculated"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, isBattleDamageCalculation(session.state) && matchesTurnPlayer(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageCalculation"));
  pushPhasePredicate(L, "IsEndStep", session, isBattleEndPhase);
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const phases = phasesFromMask(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    const count = Math.max(1, lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 1);
    for (const phase of phases) skipPhase(session, player, phase, count);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SkipPhase"));
}

function pushPhasePredicate(L: unknown, fieldName: string, session: DuelSession, predicate: (state: DuelState) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = lua.lua_isnumber(state, 1) ? normalizePlayer(lua.lua_tointeger(state, 1)) : undefined;
    lua.lua_pushboolean(state, predicate(session.state) && matchesTurnPlayer(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function matchesTurnPlayer(state: DuelState, player: PlayerId | undefined): boolean {
  return player === undefined || state.turnPlayer === player;
}

function playerTurnCount(state: DuelState, player: PlayerId): number {
  if (state.turn <= 0) return 0;
  return player === 0 ? Math.ceil(state.turn / 2) : Math.floor(state.turn / 2);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function phasesFromMask(mask: number): DuelPhase[] {
  const phases: DuelPhase[] = [];
  for (const phase of ["draw", "standby", "main1", "battle", "main2", "end"] satisfies DuelPhase[]) {
    if ((phaseMask(phase) & mask) !== 0) phases.push(phase);
  }
  return phases;
}

function isAbleToEnterBattlePhase(state: DuelState): boolean {
  return nextAvailableDuelPhase(state, state.turnPlayer, (phase) => canEnterPhase(state, phase)) === "battle";
}

function canEnterPhase(state: DuelState, phase: DuelPhase): boolean {
  if (phase !== "main1" && phase !== "battle" && phase !== "main2" && phase !== "end") return true;
  return !isPhaseEntryPrevented(state, state.turnPlayer, phase, createContinuousPhaseContext(state));
}

function skipPhase(session: DuelSession, player: PlayerId, phase: DuelPhase, count: number): void {
  const existing = session.state.skippedPhases.find((skip) => skip.player === player && skip.phase === phase);
  if (existing) existing.remaining = Math.max(existing.remaining, count);
  else session.state.skippedPhases.push({ player, phase, remaining: count });
}

function createContinuousPhaseContext(state: DuelState) {
  return (effect: DuelEffectDefinition, source: DuelCardInstance): DuelEffectContext => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard() {
      throw new Error("Cannot move cards while checking phase entry");
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}
