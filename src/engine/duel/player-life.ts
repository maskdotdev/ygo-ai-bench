import { pushDuelLog } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function damageDuelPlayer(state: DuelState, player: PlayerId, amount: number, reason = 0): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints - value);
  pushDuelLog(state, (reason & duelReason.effect) !== 0 && (reason & duelReason.battle) === 0 ? "effectDamage" : "damage", player, undefined, String(value));
  if (state.players[player].lifePoints <= 0) state.status = "ended";
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
  if (state.players[player].lifePoints <= 0) state.status = "ended";
}
