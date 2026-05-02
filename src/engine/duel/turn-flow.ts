import { resetDuelActivityCounts } from "#duel/activity.js";
import { getCards, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { pruneResetEffectsAfterPhase } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterPhase } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEventName, DuelPhase, DuelState, PlayerId } from "#duel/types.js";

export interface DuelTurnFlowHandlers {
  collectEvent(eventName: DuelEventName): void;
  executePhaseEffects?(phase: DuelPhase): void;
}

const phaseOrder: DuelPhase[] = ["draw", "standby", "main1", "battle", "main2", "end"];

export function drawDuelCardsFromDeck(state: DuelState, player: PlayerId, count: number, detail: string): number {
  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    const card = getCards(state, player, "deck").sort((a, b) => a.sequence - b.sequence)[0];
    if (!card) return drawn;
    moveDuelCard(state, card.uid, "hand", player, duelReason.rule);
    pushDuelLog(state, "draw", player, card.name, detail);
    drawn += 1;
  }
  return drawn;
}

export function nextAvailableDuelPhase(state: DuelState, player: PlayerId): DuelPhase | undefined {
  for (const phase of phaseOrder.slice(phaseOrder.indexOf(state.phase) + 1)) {
    if (!isPhaseSkipped(state, player, phase)) return phase;
  }
  return undefined;
}

export function changeDuelPhase(state: DuelState, player: PlayerId, phase: DuelPhase, handlers: DuelTurnFlowHandlers): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can change phases");
  if (phaseOrder.indexOf(phase) <= phaseOrder.indexOf(state.phase)) throw new Error(`Cannot move from ${state.phase} to ${phase}`);
  if (phase !== nextAvailableDuelPhase(state, player)) throw new Error(`Cannot move from ${state.phase} to ${phase}`);
  consumeSkippedPhases(state, player, phase);
  state.phase = phase;
  state.phaseActivity = false;
  handlers.executePhaseEffects?.(phase);
  pruneResetEffectsAfterPhase(state, phase);
  pruneDuelFlagEffectsAfterPhase(state, phase);
  if (phase === "battle") {
    state.attacksDeclared = [];
    state.attackCanceledUids = [];
    state.attackedTargetUids = [];
    state.battlePairs = [];
  }
  else clearBattleState(state);
  pushDuelLog(state, "phase", player, undefined, `Moved to ${phase}`);
  handlers.collectEvent("phaseChanged");
}

export function endDuelTurn(state: DuelState, player: PlayerId, handlers: DuelTurnFlowHandlers): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can end the turn");
  handlers.executePhaseEffects?.("end");
  pruneResetEffectsAfterPhase(state, "end");
  pruneDuelFlagEffectsAfterPhase(state, "end");
  state.turn += 1;
  state.turnPlayer = otherPlayer(player);
  state.phase = "draw";
  state.phaseActivity = false;
  handlers.executePhaseEffects?.("draw");
  pruneResetEffectsAfterPhase(state, "draw");
  pruneDuelFlagEffectsAfterPhase(state, "draw");
  state.waitingFor = state.turnPlayer;
  state.attacksDeclared = [];
  state.attackCanceledUids = [];
  state.attackedTargetUids = [];
  state.battlePairs = [];
  clearBattleState(state);
  state.positionsChanged = [];
  for (const activityPlayer of [0, 1] satisfies PlayerId[]) resetDuelActivityCounts(state, activityPlayer);
  state.players[state.turnPlayer].normalSummonAvailable = true;
  drawDuelCardsFromDeck(state, state.turnPlayer, state.options.drawPerTurn, "Turn draw");
  state.phase = "main1";
  state.phaseActivity = false;
  handlers.executePhaseEffects?.("main1");
  pruneResetEffectsAfterPhase(state, "main1");
  pruneDuelFlagEffectsAfterPhase(state, "main1");
  pushDuelLog(state, "turn", state.turnPlayer, undefined, `Turn ${state.turn} started`);
  handlers.collectEvent("turnStarted");
}

function clearBattleState(state: DuelState): void {
  delete state.currentAttack;
  delete state.pendingBattle;
  state.attackPasses = [];
  state.damagePasses = [];
  state.attackCostPaid = 0;
  delete state.battleStep;
}

function isPhaseSkipped(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  return state.skippedPhases.some((skip) => skip.player === player && skip.phase === phase && skip.remaining > 0);
}

function consumeSkippedPhases(state: DuelState, player: PlayerId, targetPhase: DuelPhase): void {
  const currentIndex = phaseOrder.indexOf(state.phase);
  const targetIndex = phaseOrder.indexOf(targetPhase);
  const skipped = new Set(phaseOrder.slice(currentIndex + 1, targetIndex).filter((phase) => isPhaseSkipped(state, player, phase)));
  for (const skip of state.skippedPhases) {
    if (skip.player === player && skipped.has(skip.phase)) skip.remaining -= 1;
  }
  state.skippedPhases = state.skippedPhases.filter((skip) => skip.remaining > 0);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
