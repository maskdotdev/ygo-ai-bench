import { moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { isLifePointLossDefeatPrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { clearEndedDuelPendingState } from "#duel/end-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function damageDuelPlayer(state: DuelState, player: PlayerId, amount: number, reason = 0): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints - value);
  pushDuelLog(state, (reason & duelReason.effect) !== 0 && (reason & duelReason.battle) === 0 ? "effectDamage" : "damage", player, undefined, String(value));
  applyLifePointDefeat(state, player);
  return value;
}

export function recoverDuelPlayer(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints += value;
  pushDuelLog(state, "recover", player, undefined, String(value));
  return value;
}

export function setDuelPlayerLifePoints(state: DuelState, player: PlayerId, lifePoints: number): void {
  state.players[player].lifePoints = Math.max(0, Math.floor(lifePoints));
  pushDuelLog(state, "setLifePoints", player, undefined, String(state.players[player].lifePoints));
  applyLifePointDefeat(state, player);
}

function applyLifePointDefeat(state: DuelState, player: PlayerId): void {
  if (state.players[player].lifePoints > 0) return;
  if (isLifePointLossDefeatPrevented(state, player, createLifePointCheckContext(state))) return;
  state.status = "ended";
  state.winner = state.players[otherPlayer(player)].lifePoints <= 0 ? "draw" : otherPlayer(player);
  clearEndedDuelPendingState(state);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
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
