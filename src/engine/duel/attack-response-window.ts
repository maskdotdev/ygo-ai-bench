import { findCard } from "#duel/card-state.js";
import { currentBattleStep, currentBattleWindowKind, isBattleDamageStep, openBattleWindowState, setBattleWindowResponsePlayer } from "#duel/battle-window-state.js";
import { pruneResetEffectsAfterPhaseFlag } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterPhaseFlag } from "#duel/flags.js";
import { resolvePendingBattle, type BattleContinuationHandlers } from "#duel/battle-continuation.js";
import { otherPlayer } from "#duel/player-id.js";
import type { BattleWindowKind, DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

type DamageBattleWindowKind = Extract<BattleWindowKind, "startDamageStep" | "beforeDamageCalculation" | "duringDamageCalculation" | "afterDamageCalculation" | "endDamageStep">;

export function openAttackResponseWindow(state: DuelState, attackingPlayer: PlayerId): void {
  state.attackPasses = [];
  state.damagePasses = [];
  const responsePlayer = otherPlayer(attackingPlayer);
  const previousKind = currentBattleWindowKind(state);
  openBattleWindowState(state, "attackNegationResponse", "attack", responsePlayer);
  pruneBattleSubphaseResets(state, "attackNegationResponse", previousKind);
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
  const attacker = findCard(state, state.pendingBattle.attackerUid);
  if (!attacker || attacker.location !== "monsterZone") {
    resolvePendingBattle(state, handlers);
    return;
  }
  if (isBattleDamageStep(state)) {
    if (state.damagePasses.length > 0) return;
    openDamageResponseWindow(state, state.turnPlayer, currentDamageWindowKind(state));
    return;
  }
  if (state.attackPasses.length > 0) return;
  openAttackResponseWindow(state, attacker.controller);
}

export function markBattleWindowChainStarted(state: DuelState): void {
  if (!state.pendingBattle) return;
  if (isBattleDamageStep(state)) state.damagePasses = [];
  else state.attackPasses = [];
}

function openDamageResponseWindow(state: DuelState, lastResponder: PlayerId, kind: DamageBattleWindowKind = "startDamageStep"): void {
  state.damagePasses = [];
  const responsePlayer = otherPlayer(lastResponder);
  const previousKind = currentBattleWindowKind(state);
  openBattleWindowState(state, kind, kind === "duringDamageCalculation" ? "damageCalculation" : "damage", responsePlayer);
  pruneBattleSubphaseResets(state, kind, previousKind);
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
    collectBattleTimingEvent(state, handlers, "damageCalculating");
    return;
  }
  if (kind === "duringDamageCalculation") {
    resolvePendingBattle(state, handlers, { preserveBattleContext: true });
    if (state.status === "ended" || !state.pendingBattle) return;
    openDamageResponseWindow(state, lastDamageResponder, "afterDamageCalculation");
    pruneResetEffectsAfterPhaseFlag(state, 0x40);
    pruneDuelFlagEffectsAfterPhaseFlag(state, 0x40);
    if (state.pendingBattle && currentBattleWindowKind(state) === "afterDamageCalculation") collectBattleTimingEvent(state, handlers, "afterDamageCalculation");
    return;
  }
  if (kind === "afterDamageCalculation") {
    openDamageResponseWindow(state, lastDamageResponder, "endDamageStep");
    collectBattleTimingEvent(state, handlers, "battleEnded");
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

function pruneBattleSubphaseResets(state: DuelState, kind: BattleWindowKind, previousKind: BattleWindowKind | undefined): void {
  if (kind === previousKind) return;
  const phaseFlag = kind === "attackNegationResponse" ? 0x10 : kind === "startDamageStep" ? 0x20 : undefined;
  if (phaseFlag === undefined) return;
  pruneResetEffectsAfterPhaseFlag(state, phaseFlag);
  pruneDuelFlagEffectsAfterPhaseFlag(state, phaseFlag);
}

function collectBattleTimingEvent(
  state: DuelState,
  handlers: BattleContinuationHandlers,
  eventName: "battleStarted" | "battleConfirmed" | "beforeDamageCalculation" | "damageCalculating" | "battleEnded" | "afterDamageCalculation" | "damageStepEnded",
): void {
  const pendingCount = state.pendingTriggers.length;
  const responsePlayer = state.battleWindow?.responsePlayer;
  const eventCards = currentBattleEventCards(state);
  handlers.collectEvent(state, eventName, eventCards.length > 0 ? eventCards : undefined);
  if (pendingCount === 0 && state.pendingTriggers.length === 0 && responsePlayer !== undefined) state.waitingFor = responsePlayer;
}

function currentBattleEventCards(state: DuelState): DuelCardInstance[] {
  const attack = state.currentAttack ?? state.pendingBattle;
  if (!attack) return [];
  const attacker = findCard(state, attack.attackerUid);
  const target = attack.targetUid === undefined ? undefined : findCard(state, attack.targetUid);
  return [attacker, target].filter((card): card is DuelCardInstance => card !== undefined);
}
