import { moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { isLifePointLossDefeatPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { clearEndedDuelPendingState } from "#duel/end-state.js";
import { otherPlayer } from "#duel/player-id.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function damageDuelPlayer(state: DuelState, player: PlayerId, amount: number, reason = 0): number {
  if (state.status === "ended") return 0;
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints - value);
  pushDuelLog(state, (reason & duelReason.effect) !== 0 && (reason & duelReason.battle) === 0 ? "effectDamage" : "damage", player, undefined, String(value));
  applyLifePointDefeat(state, player);
  return value;
}

export function recoverDuelPlayer(state: DuelState, player: PlayerId, amount: number): number {
  if (state.status === "ended") return 0;
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints += value;
  pushDuelLog(state, "recover", player, undefined, String(value));
  return value;
}

export function setDuelPlayerLifePoints(state: DuelState, player: PlayerId, lifePoints: number): void {
  if (state.status === "ended") return;
  setDuelPlayerLifePointsUnchecked(state, player, lifePoints);
  applyLifePointDefeats(state);
}

export function setDuelPlayerLifePointsUnchecked(state: DuelState, player: PlayerId, lifePoints: number): void {
  state.players[player].lifePoints = Math.max(0, Math.floor(lifePoints));
  pushDuelLog(state, "setLifePoints", player, undefined, String(state.players[player].lifePoints));
}

function applyLifePointDefeat(state: DuelState, player: PlayerId): void {
  if (state.players[player].lifePoints > 0) return;
  if (isLifePointLossDefeatPrevented(state, player, createLifePointCheckContext(state))) return;
  state.status = "ended";
  state.winner = state.players[otherPlayer(player)].lifePoints <= 0 ? "draw" : otherPlayer(player);
  clearEndedDuelPendingState(state);
  pushDuelLog(state, "win", state.winner === "draw" ? undefined : state.winner, undefined, "lp");
}

export function applyLifePointDefeats(state: DuelState): void {
  if (state.status === "ended") return;
  const player0Lost = state.players[0].lifePoints <= 0 && !isLifePointLossDefeatPrevented(state, 0, createLifePointCheckContext(state));
  const player1Lost = state.players[1].lifePoints <= 0 && !isLifePointLossDefeatPrevented(state, 1, createLifePointCheckContext(state));
  if (!player0Lost && !player1Lost) return;
  state.status = "ended";
  state.winner = player0Lost && player1Lost ? "draw" : player0Lost ? 1 : 0;
  clearEndedDuelPendingState(state);
  pushDuelLog(state, "win", state.winner === "draw" ? undefined : state.winner, undefined, "lp");
}

function createLifePointCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
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
