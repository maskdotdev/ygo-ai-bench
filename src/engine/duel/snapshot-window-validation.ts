import { assertSnapshotBattlePassWindows, assertSnapshotBattleStateConsistency, assertSnapshotBattleWindowContext } from "#duel/snapshot-battle-validation.js";
import { shouldContinueTriggerSelection } from "#duel/effect-activation.js";
import { pendingTriggerBuckets } from "#duel/trigger-buckets.js";
import type { DuelState, PendingTrigger, PlayerId } from "#duel/types.js";

export function assertSnapshotPendingWindowConsistency(state: Record<string, unknown>): void {
  assertSnapshotPassWindows(state);
  assertSnapshotAwaitingPlayer(state);
  assertSnapshotBattlePassWindows(state);
  assertSnapshotBattleStateConsistency(state);
  assertSnapshotPromptWindow(state);
  assertSnapshotTriggerWindow(state);
  assertSnapshotBattleWindowContext(state);
}

function assertSnapshotAwaitingPlayer(state: Record<string, unknown>): void {
  if (state.status === "awaiting" && state.waitingFor === undefined) throw new Error("Malformed duel snapshot: awaiting duel requires waitingFor");
  if (state.status === "ended" && state.winner === undefined) throw new Error("Malformed duel snapshot: ended duel requires winner");
  if (state.status !== "ended" && state.winner !== undefined) throw new Error("Malformed duel snapshot: active duel must not include winner");
  if (state.status !== "ended" && state.winReason !== undefined) throw new Error("Malformed duel snapshot: active duel must not include winReason");
  if (state.status === "ended" && state.waitingFor !== undefined) throw new Error("Malformed duel snapshot: ended duel must not include waitingFor");
  if (state.status === "ended" && Array.isArray(state.chainLimits) && state.chainLimits.length > 0) throw new Error("Malformed duel snapshot: ended duel must not include chain limits");
  if (state.status === "ended" && state.attackCostPaid !== 0) throw new Error("Malformed duel snapshot: ended duel must not include attackCostPaid");
  if (state.status === "ended" && isRecord(state.battleDamage) && ((state.battleDamage[0] as number) !== 0 || (state.battleDamage[1] as number) !== 0)) {
    throw new Error("Malformed duel snapshot: ended duel must not include battle damage");
  }
}

function assertSnapshotPassWindows(state: Record<string, unknown>): void {
  if ((state.chain as unknown[]).length === 0 && (state.chainPasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.chainPasses requires a pending chain");
  if ((state.chain as unknown[]).length > 0 && state.status !== "awaiting") throw new Error("Malformed duel snapshot: pending chain requires an awaiting duel");
  if (chainWindowIsActive(state) && state.waitingFor === undefined) throw new Error("Malformed duel snapshot: state.waitingFor is required for a pending chain");
  if ((state.chain as unknown[]).length > 0 && (state.chainPasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.chainPasses must not contain both players");
  if ((state.chain as unknown[]).length > 0 && state.waitingFor !== undefined && (state.chainPasses as PlayerId[]).includes(state.waitingFor as PlayerId)) throw new Error("Malformed duel snapshot: state.waitingFor must not be included in chainPasses");
}

function chainWindowIsActive(state: Record<string, unknown>): boolean {
  return state.status === "awaiting" && state.prompt === undefined && !shouldContinueTriggerSelection(state as unknown as DuelState) && (state.chain as unknown[]).length > 0;
}

function assertSnapshotPromptWindow(state: Record<string, unknown>): void {
  if (!isRecord(state.prompt)) return;
  if (state.status !== "awaiting") throw new Error("Malformed duel snapshot: pending prompt requires an awaiting duel");
  if ((state.chain as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.prompt must not overlap a pending chain");
  if ((state.pendingTriggers as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.prompt must not overlap pending triggers");
  if (state.battleWindow !== undefined) throw new Error("Malformed duel snapshot: state.prompt must not overlap battleWindow");
  if (state.waitingFor !== state.prompt.player) throw new Error("Malformed duel snapshot: state.waitingFor must match prompt.player");
}

function assertSnapshotTriggerWindow(state: Record<string, unknown>): void {
  const pendingTriggers = state.pendingTriggers as PendingTrigger[];
  if (state.prompt !== undefined || pendingTriggers.length === 0 || !shouldContinueTriggerSelection(state as unknown as DuelState)) return;
  if (state.status !== "awaiting") throw new Error("Malformed duel snapshot: pending trigger window requires an awaiting duel");
  const activeBucket = pendingTriggerBuckets(pendingTriggers)[0];
  if (activeBucket && state.waitingFor !== activeBucket.player) throw new Error("Malformed duel snapshot: state.waitingFor must match active trigger bucket player");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
