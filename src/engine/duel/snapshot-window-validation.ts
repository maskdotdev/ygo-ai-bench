import { pendingTriggerBuckets } from "#duel/trigger-buckets.js";
import type { PendingTrigger, PlayerId } from "#duel/types.js";

export function assertSnapshotPendingWindowConsistency(state: Record<string, unknown>): void {
  assertSnapshotPassWindows(state);
  assertSnapshotBattleStateConsistency(state);
  assertSnapshotPromptWindow(state);
  assertSnapshotTriggerWindow(state);
  assertSnapshotBattleWindowContext(state);
}

function assertSnapshotPassWindows(state: Record<string, unknown>): void {
  if ((state.chain as unknown[]).length === 0 && (state.chainPasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.chainPasses requires a pending chain");
  if (chainWindowIsActive(state) && state.waitingFor === undefined) throw new Error("Malformed duel snapshot: state.waitingFor is required for a pending chain");
  if ((state.chain as unknown[]).length > 0 && (state.chainPasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.chainPasses must not contain both players");
  if ((state.chain as unknown[]).length > 0 && state.waitingFor !== undefined && (state.chainPasses as PlayerId[]).includes(state.waitingFor as PlayerId)) throw new Error("Malformed duel snapshot: state.waitingFor must not be included in chainPasses");
  if (state.pendingBattle === undefined && (state.attackPasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.attackPasses requires a pending battle");
  if (state.pendingBattle === undefined && (state.damagePasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.damagePasses requires a pending battle");
  if ((state.attackPasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.attackPasses must not contain both players");
  if ((state.damagePasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.damagePasses must not contain both players");
  const battleStep = isRecord(state.battleWindow) ? state.battleWindow.step : state.battleStep;
  if ((state.attackPasses as unknown[]).length > 0 && battleStep !== "attack") throw new Error("Malformed duel snapshot: state.attackPasses requires an attack battle step");
  if ((state.damagePasses as unknown[]).length > 0 && battleStep !== "damage" && battleStep !== "damageCalculation") throw new Error("Malformed duel snapshot: state.damagePasses requires a damage battle step");
}

function chainWindowIsActive(state: Record<string, unknown>): boolean {
  return state.status === "awaiting" && state.prompt === undefined && (state.chain as unknown[]).length > 0;
}

function assertSnapshotBattleStateConsistency(state: Record<string, unknown>): void {
  if (!isRecord(state.currentAttack) || !isRecord(state.pendingBattle)) return;
  if (state.currentAttack.attackerUid !== state.pendingBattle.attackerUid) throw new Error("Malformed duel snapshot: state.pendingBattle.attackerUid must match currentAttack");
  if (state.currentAttack.targetUid !== state.pendingBattle.targetUid) throw new Error("Malformed duel snapshot: state.pendingBattle.targetUid must match currentAttack");
  if (state.currentAttack.replayTargetCount !== state.pendingBattle.replayTargetCount) throw new Error("Malformed duel snapshot: state.pendingBattle.replayTargetCount must match currentAttack");
  if (!sameOptionalStringArray(state.currentAttack.replayTargetUids, state.pendingBattle.replayTargetUids)) throw new Error("Malformed duel snapshot: state.pendingBattle.replayTargetUids must match currentAttack");
}

function assertSnapshotBattleWindowContext(state: Record<string, unknown>): void {
  if (state.battleWindow === undefined) return;
  if (state.pendingBattle === undefined && state.currentAttack === undefined) throw new Error("Malformed duel snapshot: state.battleWindow requires battle state");
  assertBattleWindowMatchesBattleState(state);
  if (isRecord(state.battleWindow) && state.battleWindow.attackNegated) throw new Error("Malformed duel snapshot: state.battleWindow.attackNegated cannot be pending");
  assertReplayDecisionWindowMatchesAttacker(state);
  if (state.battleStep !== undefined && isRecord(state.battleWindow) && state.battleStep !== state.battleWindow.step) throw new Error("Malformed duel snapshot: state.battleStep must match battleWindow.step");
  if (battleWindowIsActivePendingWindow(state) && isRecord(state.battleWindow) && state.waitingFor !== state.battleWindow.responsePlayer) throw new Error("Malformed duel snapshot: state.waitingFor must match battleWindow.responsePlayer");
  assertActiveBattleResponsePlayerHasNotPassed(state);
}

function battleWindowIsActivePendingWindow(state: Record<string, unknown>): boolean {
  return state.prompt === undefined && (state.chain as unknown[]).length === 0 && (state.pendingTriggers as unknown[]).length === 0;
}

function assertBattleWindowMatchesBattleState(state: Record<string, unknown>): void {
  if (!isRecord(state.battleWindow)) return;
  const battle = isRecord(state.pendingBattle) ? state.pendingBattle : state.currentAttack;
  if (!isRecord(battle)) return;
  if (state.battleWindow.attackerUid !== battle.attackerUid) throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must match battle state");
  if (state.battleWindow.targetUid !== battle.targetUid) throw new Error("Malformed duel snapshot: state.battleWindow.targetUid must match battle state");
}

function assertReplayDecisionWindowMatchesAttacker(state: Record<string, unknown>): void {
  if (!isRecord(state.battleWindow) || state.battleWindow.kind !== "replayDecision") return;
  const attacker = findSnapshotCard(state, state.battleWindow.attackerUid);
  if (attacker?.location !== "monsterZone") throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must reference a monster-zone card for replay decision");
  if (state.battleWindow.responsePlayer !== attacker.controller) throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must match replay attacker controller");
}

function assertActiveBattleResponsePlayerHasNotPassed(state: Record<string, unknown>): void {
  if (!battleWindowIsActivePendingWindow(state) || !isRecord(state.battleWindow)) return;
  const responsePlayer = state.battleWindow.responsePlayer as PlayerId;
  if (state.battleWindow.step === "attack" && (state.attackPasses as PlayerId[]).includes(responsePlayer)) {
    throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in attackPasses");
  }
  if ((state.battleWindow.step === "damage" || state.battleWindow.step === "damageCalculation") && (state.damagePasses as PlayerId[]).includes(responsePlayer)) {
    throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in damagePasses");
  }
}

function assertSnapshotPromptWindow(state: Record<string, unknown>): void {
  if (!isRecord(state.prompt)) return;
  if (state.waitingFor !== state.prompt.player) throw new Error("Malformed duel snapshot: state.waitingFor must match prompt.player");
}

function assertSnapshotTriggerWindow(state: Record<string, unknown>): void {
  const pendingTriggers = state.pendingTriggers as PendingTrigger[];
  if (state.prompt !== undefined || (state.chain as unknown[]).length > 0 || pendingTriggers.length === 0) return;
  const activeBucket = pendingTriggerBuckets(pendingTriggers)[0];
  if (activeBucket && state.waitingFor !== activeBucket.player) throw new Error("Malformed duel snapshot: state.waitingFor must match active trigger bucket player");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findSnapshotCard(state: Record<string, unknown>, uid: unknown): Record<string, unknown> | undefined {
  return (state.cards as unknown[]).find((card) => isRecord(card) && card.uid === uid) as Record<string, unknown> | undefined;
}

function sameOptionalStringArray(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((uid, index) => uid === right[index]);
}
