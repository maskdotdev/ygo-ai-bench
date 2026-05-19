import fengari from "fengari";
import { moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { isEffectDefeatPrevented, matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { collectDuelTriggerEffects, damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/core.js";
import { applyLifePointDefeats, setDuelPlayerLifePointsUnchecked } from "#duel/player-life.js";
import { clearEndedDuelPendingState } from "#duel/end-state.js";
import { duelReason } from "#duel/reasons.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession, DuelWinner, PlayerId } from "#duel/types.js";

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
    if (hostState.activeContext) {
      setDuelPlayerLifePointsUnchecked(session.state, player, value);
      hostState.pendingSetLpDefeat = true;
    } else {
      setDuelPlayerLifePoints(session.state, player, value);
    }
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
    const result = applyLuaDamage(session, hostState, player, value, reason);
    if (result.applied > 0 && (result.eventName !== "damageDealt" || session.state.status !== "ended")) {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      markLuaOperationTimingBoundary(session, hostState);
      collectDuelTriggerEffects(session.state, result.eventName, undefined, { eventPlayer: result.player, eventValue: result.applied, ...luaEffectReasonPayload(hostState, reason, reasonPlayer) });
      if (hostState.activeContext) hostState.activeOperationMoved = true;
    }
    lua.lua_pushinteger(state, result.applied);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const result = applyLuaRecover(session, hostState, player, value, reason);
    if (result.applied > 0 && (result.eventName !== "damageDealt" || session.state.status !== "ended")) {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      markLuaOperationTimingBoundary(session, hostState);
      collectDuelTriggerEffects(session.state, result.eventName, undefined, { eventPlayer: result.player, eventValue: result.applied, ...luaEffectReasonPayload(hostState, reason, reasonPlayer) });
      if (hostState.activeContext) hostState.activeOperationMoved = true;
    }
    lua.lua_pushinteger(state, result.applied);
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

export function applyPendingLuaSetLpDefeat(hostState: LuaOperationTimingBoundaryHostState & { session: DuelSession }): void {
  if (!hostState.pendingSetLpDefeat) return;
  hostState.pendingSetLpDefeat = false;
  applyLifePointDefeats(hostState.session.state);
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

type LuaLifePointEventName = "damageDealt" | "recoveredLifePoints";

interface LuaLifePointResult {
  applied: number;
  eventName: LuaLifePointEventName;
  player: PlayerId;
}

function applyLuaDamage(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, amount: number, reason: number): LuaLifePointResult {
  const value = Math.max(0, Math.floor(amount));
  if (session.state.status === "ended" || value <= 0) return { applied: 0, eventName: "damageDealt", player };
  const damagePlayer = reflectedEffectDamagePlayer(session, hostState, player, value, reason);
  const changedValue = changedEffectDamageAmount(session, hostState, damagePlayer, value, reason);
  if (changedValue <= 0 || isEffectDamagePrevented(session, hostState, damagePlayer, reason)) return { applied: 0, eventName: "damageDealt", player: damagePlayer };
  if (isEffectDamageReversed(session, hostState, damagePlayer, reason)) {
    return { applied: recoverDuelPlayer(session.state, damagePlayer, changedValue), eventName: "recoveredLifePoints", player: damagePlayer };
  }
  return { applied: damageDuelPlayer(session.state, damagePlayer, changedValue, reason), eventName: "damageDealt", player: damagePlayer };
}

function applyLuaRecover(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, amount: number, reason: number): LuaLifePointResult {
  const value = Math.max(0, Math.floor(amount));
  if (session.state.status === "ended" || value <= 0) return { applied: 0, eventName: "recoveredLifePoints", player };
  if (isEffectRecoveryReversed(session, hostState, player, reason) && !isEffectDamagePrevented(session, hostState, player, reason)) {
    return { applied: damageDuelPlayer(session.state, player, value, reason), eventName: "damageDealt", player };
  }
  return { applied: recoverDuelPlayer(session.state, player, value), eventName: "recoveredLifePoints", player };
}

function isEffectDamagePrevented(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, reason: number): boolean {
  return isEffectLifePointEffectApplied(session, hostState, player, reason, 335);
}

function isEffectDamageReversed(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, reason: number): boolean {
  return isEffectLifePointEffectApplied(session, hostState, player, reason, 80);
}

function isEffectRecoveryReversed(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, reason: number): boolean {
  return isEffectLifePointEffectApplied(session, hostState, player, reason, 81);
}

function reflectedEffectDamagePlayer(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, amount: number, reason: number): PlayerId {
  if ((reason & duelReason.effect) === 0) return player;
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const createContext = createLifePointEffectContext(session, hostState, reason, reasonPlayer, amount);
  for (const { effect, source } of matchingPlayerEffects(session.state, player, 83, createContext)) {
    const ctx = createContext(effect, source);
    if (!effect.valuePredicate || effect.valuePredicate(ctx, reasonPlayer)) return otherPlayer(player);
  }
  return player;
}

function changedEffectDamageAmount(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, amount: number, reason: number): number {
  if ((reason & duelReason.effect) === 0) return amount;
  let value = amount;
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const createContext = createLifePointEffectContext(session, hostState, reason, reasonPlayer, amount);
  for (const { effect, source } of matchingPlayerEffects(session.state, player, 82, createContext)) {
    const ctx = createContext(effect, source);
    const next = effect.lifePointValue?.(ctx, player, value) ?? effect.value;
    value = applyLifePointDamageValue(value, next);
  }
  return value;
}

function isEffectLifePointEffectApplied(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, player: PlayerId, reason: number, code: number): boolean {
  if ((reason & duelReason.effect) === 0) return false;
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const createContext = createLifePointEffectContext(session, hostState, reason, reasonPlayer);
  return matchingPlayerEffects(session.state, player, code, createContext).some(({ effect, source }) => {
    const ctx = createContext(effect, source);
    return !effect.valuePredicate || effect.valuePredicate(ctx, reasonPlayer);
  });
}

function applyLifePointDamageValue(amount: number, value: number | undefined): number {
  if (value === undefined || value < 0) return amount;
  if (value === 0x80000000) return amount * 2;
  if (value === 0x80000001) return Math.floor(amount / 2);
  return Math.max(0, Math.floor(value));
}

function createLifePointEffectContext(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState, reason: number, reasonPlayer: PlayerId, eventValue?: number): ContinuousEffectContextFactory {
  return (effect, source, card) => {
    const targetUids = card ? [card.uid] : [];
    const ctx: DuelEffectContext = {
      duel: session.state,
      source,
      player: effect.controller,
      checkOnly: true,
      eventReason: reason,
      eventReasonPlayer: reasonPlayer,
      ...(eventValue === undefined ? {} : { eventValue }),
      ...(hostState.activeContext?.chainLink === undefined ? {} : { chainLink: hostState.activeContext.chainLink }),
      targetUids,
      log() {},
      moveCard(uid: string, to, controller?: PlayerId): DuelCardInstance {
        return moveDuelCard(session.state, uid, to, controller);
      },
      negateChainLink() {
        return false;
      },
      setTargets(uids) {
        targetUids.splice(0, targetUids.length, ...uids);
      },
      getTargets() {
        return targetUids.map((uid) => session.state.cards.find((candidate) => candidate.uid === uid)).filter((candidate): candidate is DuelCardInstance => Boolean(candidate));
      },
      setTargetPlayer(target) {
        ctx.targetPlayer = target;
      },
      setTargetParam(parameter) {
        ctx.targetParam = parameter;
      },
    };
    return ctx;
  };
}
