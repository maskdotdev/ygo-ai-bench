import fengari from "fengari";
import { currentBattleStep, isBattleAttackStep, isBattleDamageCalculation, isBattleDamageStep } from "#duel/battle-window-state.js";
import { isPhaseEntryPrevented } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelPhase, DuelSession, DuelState, PlayerId } from "#duel/types.js";

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
    lua.lua_pushinteger(state, currentPhaseMask(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const phase = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    lua.lua_pushboolean(state, (currentPhaseMask(session.state) & phase) !== 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPhase"));
  pushPhasePredicate(L, "IsDrawPhase", session, (state) => state.phase === "draw");
  pushPhasePredicate(L, "IsStandbyPhase", session, (state) => state.phase === "standby");
  pushPhasePredicate(L, "IsMainPhase1", session, (state) => state.phase === "main1");
  pushPhasePredicate(L, "IsStartOfBattlePhase", session, isStartOfBattlePhase);
  pushPhasePredicate(L, "IsStartStep", session, isStartOfBattlePhase);
  pushPhasePredicate(L, "IsBattleStep", session, (state) => state.phase === "battle" && isBattleAttackStep(state));
  pushPhasePredicate(L, "IsEndOfBattlePhase", session, (state) => state.phase === "battle" && currentBattleStep(state) === undefined);
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
    lua.lua_pushboolean(state, session.state.phase === "battle");
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, isAbleToEnterBattlePhase(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToEnterBP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, isBattleDamageStep(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageStep"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, isBattleDamageCalculation(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageCalculated"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, isBattleDamageCalculation(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDamageCalculation"));
  pushPhasePredicate(L, "IsEndStep", session, (state) => state.phase === "battle" && currentBattleStep(state) === undefined);
  lua.lua_pushcfunction(L, (state: unknown) => {
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
    lua.lua_pushboolean(state, predicate(session.state) && (player === undefined || session.state.turnPlayer === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function currentPhaseMask(state: DuelState): number {
  if (state.phase === "battle" && currentBattleStep(state) === "damage") return 0x20;
  if (state.phase === "battle" && currentBattleStep(state) === "damageCalculation") return 0x40;
  return phaseMask(state.phase);
}

function isStartOfBattlePhase(state: DuelState): boolean {
  return state.phase === "battle" && currentBattleStep(state) === undefined && !state.currentAttack && !state.pendingBattle && state.attacksDeclared.length === 0;
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

function isAbleToEnterBattlePhase(state: DuelState): boolean {
  return nextAvailablePhase(state, state.turnPlayer) === "battle" && !isPhaseEntryPrevented(state, state.turnPlayer, "battle", createContinuousPhaseContext(state));
}

function nextAvailablePhase(state: DuelState, player: PlayerId): DuelPhase | undefined {
  const phaseOrder = ["draw", "standby", "main1", "battle", "main2", "end"] satisfies DuelPhase[];
  for (const phase of phaseOrder.slice(phaseOrder.indexOf(state.phase) + 1)) {
    if (!isPhaseSkipped(state, player, phase)) return phase;
  }
  return undefined;
}

function isPhaseSkipped(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  return state.skippedPhases.some((skip) => skip.player === player && skip.phase === phase && skip.remaining > 0);
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
