import { findCard } from "#duel/card-state.js";
import { resolvePendingBattle, type BattleContinuationHandlers } from "#duel/battle-continuation.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function openAttackResponseWindow(state: DuelState, attackingPlayer: PlayerId): void {
  state.attackPasses = [];
  state.damagePasses = [];
  state.battleStep = "attack";
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
  openDamageResponseWindow(state, player);
}

export function passDamageResponseWindow(state: DuelState, player: PlayerId, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || !isDamageBattleStep(state)) throw new Error("No damage response window is pending");
  if (!state.damagePasses.includes(player)) state.damagePasses.push(player);
  const nextPlayer = otherPlayer(player);
  if (!state.damagePasses.includes(nextPlayer)) {
    state.waitingFor = nextPlayer;
    return;
  }
  state.damagePasses = [];
  if (state.battleStep === "damage") {
    openDamageCalculationWindow(state, player);
    return;
  }
  resolvePendingBattle(state, handlers);
}

export function continueAttackResponseWindow(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  if (isDamageBattleStep(state)) {
    if (state.damagePasses.length > 0) return;
    openDamageResponseWindow(state, state.turnPlayer, state.battleStep === "damageCalculation" ? "damageCalculation" : "damage");
    return;
  }
  if (state.attackPasses.length > 0) return;
  const attacker = findCard(state, state.pendingBattle.attackerUid);
  openAttackResponseWindow(state, attacker?.controller ?? state.turnPlayer);
}

export function markBattleWindowChainStarted(state: DuelState): void {
  if (!state.pendingBattle) return;
  if (isDamageBattleStep(state)) state.damagePasses = [];
  else state.attackPasses = [];
}

function openDamageResponseWindow(state: DuelState, lastResponder: PlayerId, step: "damage" | "damageCalculation" = "damage"): void {
  state.damagePasses = [];
  state.battleStep = step;
  state.waitingFor = otherPlayer(lastResponder);
}

function openDamageCalculationWindow(state: DuelState, lastDamageResponder: PlayerId): void {
  openDamageResponseWindow(state, lastDamageResponder, "damageCalculation");
}

function isDamageBattleStep(state: DuelState): boolean {
  return state.battleStep === "damage" || state.battleStep === "damageCalculation";
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
