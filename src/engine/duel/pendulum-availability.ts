import type { DuelState, PlayerId } from "#duel/types.js";

export function hasPendulumSummonAvailable(state: DuelState, player: PlayerId): boolean {
  return state.players[player].pendulumSummonAvailable || extraPendulumSummons(state, player) > 0;
}

export function grantExtraPendulumSummons(state: DuelState, player: PlayerId, count = 1): void {
  const amount = Math.max(0, Math.floor(count));
  if (amount === 0) return;
  state.players[player].extraPendulumSummons = extraPendulumSummons(state, player) + amount;
}

export function consumePendulumSummon(state: DuelState, player: PlayerId): void {
  if (state.players[player].pendulumSummonAvailable) {
    state.players[player].pendulumSummonAvailable = false;
    return;
  }
  state.players[player].extraPendulumSummons = Math.max(0, extraPendulumSummons(state, player) - 1);
}

function extraPendulumSummons(state: DuelState, player: PlayerId): number {
  return Math.max(0, Math.floor(state.players[player].extraPendulumSummons ?? 0));
}
