import { resetDuelActivityCounts } from "#duel/activity.js";
import { clearBattleWindowState } from "#duel/battle-window-state.js";
import { getCards, moveDuelCard, pushDuelLog } from "#duel/card-state.js";
import { pruneResetEffectsAfterPhase } from "#duel/effect-reset.js";
import { clearEndedDuelPendingState } from "#duel/end-state.js";
import { pruneDuelFlagEffectsAfterPhase } from "#duel/flags.js";
import { otherPlayer } from "#duel/player-id.js";
import { duelReason } from "#duel/reasons.js";
import { duelPhases } from "#duel/state-kinds.js";
import { phaseEventCode, phaseStartEventCode, phaseTimingEventCode } from "#duel/event-codes.js";
import type { DuelEventName, DuelPhase, DuelState, PlayerId } from "#duel/types.js";

export interface DuelTurnFlowHandlers {
  collectEvent(eventName: DuelEventName, eventCode?: number): void;
  applyHandLimit?(player: PlayerId): void;
  canDraw?(player: PlayerId): boolean;
  canLoseByDeck?(player: PlayerId): boolean;
  canEnterPhase?(phase: DuelPhase): boolean;
  executePhaseEffects?(phase: DuelPhase): void;
}

const phaseOrder = duelPhases;

export function drawDuelCardsFromDeck(state: DuelState, player: PlayerId, count: number, detail: string, canLoseByDeck: (player: PlayerId) => boolean = () => false): number {
  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    const card = getCards(state, player, "deck").sort((a, b) => a.sequence - b.sequence)[0];
    if (!card) {
      if (canLoseByDeck(player)) applyDeckDefeat(state, player);
      return drawn;
    }
    moveDuelCard(state, card.uid, "hand", player, duelReason.rule);
    pushDuelLog(state, "draw", player, card.name, detail);
    drawn += 1;
  }
  return drawn;
}

export function nextAvailableDuelPhase(state: DuelState, player: PlayerId, canEnterPhase: (phase: DuelPhase) => boolean = () => true): DuelPhase | undefined {
  for (const phase of phaseOrder.slice(phaseOrder.indexOf(state.phase) + 1)) {
    if (!canEnterPhase(phase)) continue;
    if (!isDuelPhaseSkipped(state, player, phase)) return phase;
  }
  return undefined;
}

export function changeDuelPhase(state: DuelState, player: PlayerId, phase: DuelPhase, handlers: DuelTurnFlowHandlers): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can change phases");
  if (phaseOrder.indexOf(phase) <= phaseOrder.indexOf(state.phase)) throw new Error(`Cannot move from ${state.phase} to ${phase}`);
  if (phase !== nextAvailableDuelPhase(state, player, handlers.canEnterPhase)) throw new Error(`Cannot move from ${state.phase} to ${phase}`);
  if (state.phase === "battle") handlers.collectEvent("phaseBattle", phaseTimingEventCode("battle"));
  consumeSkippedPhases(state, player, phase);
  state.phase = phase;
  state.phaseActivity = false;
  handlers.collectEvent(phaseStartEventName(phase), phaseStartEventCode(phase));
  handlers.executePhaseEffects?.(phase);
  if (phase === "battle") {
    state.attacksDeclared = [];
    state.attackCanceledUids = [];
    state.attackedTargetUids = [];
    state.battlePairs = [];
  }
  else clearBattleState(state);
  pushDuelLog(state, "phase", player, undefined, `Moved to ${phase}`);
  handlers.collectEvent("phaseChanged");
  handlers.collectEvent(phaseEventName(phase), phaseEventCode(phase));
  pruneResetEffectsAfterPhase(state, phase);
  pruneDuelFlagEffectsAfterPhase(state, phase);
}

export function endDuelTurn(state: DuelState, player: PlayerId, handlers: DuelTurnFlowHandlers): void {
  if (state.turnPlayer !== player) throw new Error("Only the turn player can end the turn");
  handlers.executePhaseEffects?.("end");
  handlers.applyHandLimit?.(player);
  pruneResetEffectsAfterPhase(state, "end");
  pruneDuelFlagEffectsAfterPhase(state, "end");
  state.players[player].extraPendulumSummons = 0;
  delete state.players[player].extraPendulumSummonGrants;
  state.turn += 1;
  state.turnPlayer = otherPlayer(player);
  handlers.collectEvent("turnEnded");
  const drawSkipped = consumeImmediateSkippedPhase(state, state.turnPlayer, "draw");
  if (!drawSkipped) {
    state.phase = "draw";
    state.phaseActivity = false;
    handlers.collectEvent("phaseStartDraw", phaseStartEventCode("draw"));
    handlers.executePhaseEffects?.("draw");
  }
  state.waitingFor = state.turnPlayer;
  state.attacksDeclared = [];
  state.attackCanceledUids = [];
  state.attackedTargetUids = [];
  state.battlePairs = [];
  clearBattleState(state);
  state.positionsChanged = [];
  for (const activityPlayer of [0, 1] satisfies PlayerId[]) resetDuelActivityCounts(state, activityPlayer);
  state.players[state.turnPlayer].normalSummonAvailable = true;
  state.players[state.turnPlayer].pendulumSummonAvailable = true;
  state.players[state.turnPlayer].extraPendulumSummons = 0;
  delete state.players[state.turnPlayer].extraPendulumSummonGrants;
  if (!drawSkipped) {
    handlers.collectEvent("preDraw");
    if (handlers.canDraw?.(state.turnPlayer) ?? true) drawDuelCardsFromDeck(state, state.turnPlayer, state.options.drawPerTurn, "Turn draw", (drawPlayer) => handlers.canLoseByDeck?.(drawPlayer) ?? true);
    if (state.status === "ended") return;
    handlers.collectEvent("phaseDraw", phaseEventCode("draw"));
    pruneResetEffectsAfterPhase(state, "draw");
    pruneDuelFlagEffectsAfterPhase(state, "draw");
  }
  state.phase = "main1";
  state.phaseActivity = false;
  handlers.collectEvent("phaseStartMain1", phaseStartEventCode("main1"));
  handlers.executePhaseEffects?.("main1");
  pruneResetEffectsAfterPhase(state, "main1");
  pruneDuelFlagEffectsAfterPhase(state, "main1");
  pushDuelLog(state, "turn", state.turnPlayer, undefined, `Turn ${state.turn} started`);
  handlers.collectEvent("turnStarted");
  handlers.collectEvent("phaseMain1", phaseEventCode("main1"));
}

function phaseEventName(phase: DuelPhase): DuelEventName {
  if (phase === "draw") return "phaseDraw";
  if (phase === "standby") return "phaseStandby";
  if (phase === "main1") return "phaseMain1";
  if (phase === "battle") return "phaseBattle";
  if (phase === "main2") return "phaseMain2";
  return "phaseEnd";
}

function phaseStartEventName(phase: DuelPhase): DuelEventName {
  if (phase === "draw") return "phaseStartDraw";
  if (phase === "standby") return "phaseStartStandby";
  if (phase === "main1") return "phaseStartMain1";
  if (phase === "battle") return "phaseStartBattle";
  if (phase === "main2") return "phaseStartMain2";
  return "phaseStartEnd";
}

function clearBattleState(state: DuelState): void {
  delete state.currentAttack;
  delete state.pendingBattle;
  state.attackPasses = [];
  state.damagePasses = [];
  state.attackCostPaid = 0;
  clearBattleWindowState(state);
}

export function isDuelPhaseSkipped(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  return state.skippedPhases.some((skip) => skip.player === player && skip.phase === phase && skip.remaining > 0);
}

function consumeSkippedPhases(state: DuelState, player: PlayerId, targetPhase: DuelPhase): void {
  const currentIndex = phaseOrder.indexOf(state.phase);
  const targetIndex = phaseOrder.indexOf(targetPhase);
  const skipped = new Set(phaseOrder.slice(currentIndex, targetIndex).filter((phase) => isDuelPhaseSkipped(state, player, phase)));
  for (const skip of state.skippedPhases) {
    if (skip.player === player && skipped.has(skip.phase)) skip.remaining -= 1;
  }
  state.skippedPhases = state.skippedPhases.filter((skip) => skip.remaining > 0);
}

function consumeImmediateSkippedPhase(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  const skipped = state.skippedPhases.find((skip) => skip.player === player && skip.phase === phase && skip.remaining > 0);
  if (!skipped) return false;
  skipped.remaining -= 1;
  state.skippedPhases = state.skippedPhases.filter((skip) => skip.remaining > 0);
  return true;
}

function applyDeckDefeat(state: DuelState, player: PlayerId): void {
  if ((state.players[player].initialMainDeckSize ?? 0) <= state.options.startingHandSize) return;
  state.status = "ended";
  state.winner = otherPlayer(player);
  clearEndedDuelPendingState(state);
  pushDuelLog(state, "win", state.winner, undefined, "deck");
}
