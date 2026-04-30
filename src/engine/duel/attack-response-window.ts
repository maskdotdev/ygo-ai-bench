import { findCard } from "#duel/card-state.js";
import { resolvePendingBattle, type BattleContinuationHandlers } from "#duel/battle-continuation.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function openAttackResponseWindow(state: DuelState, attackingPlayer: PlayerId): void {
  state.attackPasses = [];
  state.waitingFor = otherPlayer(attackingPlayer);
}

export function passAttackResponseWindow(state: DuelState, player: PlayerId, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle) throw new Error("No attack response window is pending");
  if (!state.attackPasses.includes(player)) state.attackPasses.push(player);
  const nextPlayer = otherPlayer(player);
  if (!state.attackPasses.includes(nextPlayer)) {
    state.waitingFor = nextPlayer;
    return;
  }
  state.attackPasses = [];
  resolvePendingBattle(state, handlers);
}

export function continueAttackResponseWindow(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length || state.attackPasses.length > 0) return;
  const attacker = findCard(state, state.pendingBattle.attackerUid);
  openAttackResponseWindow(state, attacker?.controller ?? state.turnPlayer);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
