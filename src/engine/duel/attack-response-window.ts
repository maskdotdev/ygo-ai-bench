import { findCard } from "#duel/card-state.js";
import { currentBattleStep, currentBattleWindowKind, isBattleDamageStep, openBattleWindowState, setBattleWindowResponsePlayer } from "#duel/battle-window-state.js";
import { resolvePendingBattle, type BattleContinuationHandlers } from "#duel/battle-continuation.js";
import type { BattleWindowKind, DuelState, PlayerId } from "#duel/types.js";

type DamageBattleWindowKind = Extract<BattleWindowKind, "startDamageStep" | "beforeDamageCalculation" | "duringDamageCalculation" | "afterDamageCalculation" | "endDamageStep">;

export function openAttackResponseWindow(state: DuelState, attackingPlayer: PlayerId): void {
  state.attackPasses = [];
  state.damagePasses = [];
  const responsePlayer = otherPlayer(attackingPlayer);
  openBattleWindowState(state, "attackNegationResponse", "attack", responsePlayer);
  state.waitingFor = responsePlayer;
}

export function passAttackResponseWindow(state: DuelState, player: PlayerId, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle) throw new Error("No attack response window is pending");
  if (!state.attackPasses.includes(player)) state.attackPasses.push(player);
  const nextPlayer = otherPlayer(player);
  if (!state.attackPasses.includes(nextPlayer)) {
    setBattleWindowResponsePlayer(state, nextPlayer);
    state.waitingFor = nextPlayer;
    return;
  }
  state.attackPasses = [];
  openDamageResponseWindow(state, player);
  collectBattleTimingEvent(state, handlers, "battleStarted");
  collectBattleTimingEvent(state, handlers, "battleConfirmed");
}

export function passDamageResponseWindow(state: DuelState, player: PlayerId, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || !isBattleDamageStep(state)) throw new Error("No damage response window is pending");
  if (!state.damagePasses.includes(player)) state.damagePasses.push(player);
  const nextPlayer = otherPlayer(player);
  if (!state.damagePasses.includes(nextPlayer)) {
    setBattleWindowResponsePlayer(state, nextPlayer);
    state.waitingFor = nextPlayer;
    return;
  }
  state.damagePasses = [];
  advanceDamageWindow(state, player, handlers);
}

export function continueAttackResponseWindow(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  if (isBattleDamageStep(state)) {
    if (state.damagePasses.length > 0) return;
    openDamageResponseWindow(state, state.turnPlayer, currentDamageWindowKind(state));
    return;
  }
  if (state.attackPasses.length > 0) return;
  const attacker = findCard(state, state.pendingBattle.attackerUid);
  openAttackResponseWindow(state, attacker?.controller ?? state.turnPlayer);
}

export function markBattleWindowChainStarted(state: DuelState): void {
  if (!state.pendingBattle) return;
  if (isBattleDamageStep(state)) state.damagePasses = [];
  else state.attackPasses = [];
}

function openDamageResponseWindow(state: DuelState, lastResponder: PlayerId, kind: DamageBattleWindowKind = "startDamageStep"): void {
  state.damagePasses = [];
  const responsePlayer = otherPlayer(lastResponder);
  openBattleWindowState(state, kind, kind === "duringDamageCalculation" ? "damageCalculation" : "damage", responsePlayer);
  state.waitingFor = responsePlayer;
}

function advanceDamageWindow(state: DuelState, lastDamageResponder: PlayerId, handlers: BattleContinuationHandlers): void {
  const kind = currentBattleWindowKind(state);
  if (kind === "startDamageStep") {
    openDamageResponseWindow(state, lastDamageResponder, "beforeDamageCalculation");
    collectBattleTimingEvent(state, handlers, "beforeDamageCalculation");
    return;
  }
  if (kind === "beforeDamageCalculation") {
    openDamageResponseWindow(state, lastDamageResponder, "duringDamageCalculation");
    return;
  }
  if (kind === "duringDamageCalculation") {
    openDamageResponseWindow(state, lastDamageResponder, "afterDamageCalculation");
    collectBattleTimingEvent(state, handlers, "afterDamageCalculation");
    return;
  }
  if (kind === "afterDamageCalculation") {
    openDamageResponseWindow(state, lastDamageResponder, "endDamageStep");
    collectBattleTimingEvent(state, handlers, "damageStepEnded");
    return;
  }
  resolvePendingBattle(state, handlers);
}

function currentDamageWindowKind(state: DuelState): DamageBattleWindowKind {
  const kind = currentBattleWindowKind(state);
  if (kind === "beforeDamageCalculation" || kind === "duringDamageCalculation" || kind === "afterDamageCalculation" || kind === "endDamageStep") return kind;
  return "startDamageStep";
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function collectBattleTimingEvent(
  state: DuelState,
  handlers: BattleContinuationHandlers,
  eventName: "battleStarted" | "battleConfirmed" | "beforeDamageCalculation" | "afterDamageCalculation" | "damageStepEnded",
): void {
  const pendingCount = state.pendingTriggers.length;
  const responsePlayer = state.battleWindow?.responsePlayer;
  handlers.collectEvent(state, eventName);
  if (pendingCount === 0 && state.pendingTriggers.length === 0 && responsePlayer !== undefined) state.waitingFor = responsePlayer;
}
