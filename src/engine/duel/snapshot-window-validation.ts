import { assertSnapshotBattlePassWindows, assertSnapshotBattleStateConsistency, assertSnapshotBattleWindowContext } from "#duel/snapshot-battle-validation.js";
import { pendingTriggerBuckets } from "#duel/trigger-buckets.js";
import type { PendingTrigger, PlayerId } from "#duel/types.js";

export function assertSnapshotPendingWindowConsistency(state: Record<string, unknown>): void {
  assertSnapshotPassWindows(state);
  assertSnapshotBattlePassWindows(state);
  assertSnapshotBattleStateConsistency(state);
  assertSnapshotPromptWindow(state);
  assertSnapshotTriggerWindow(state);
  assertSnapshotBattleWindowContext(state);
}

function assertSnapshotPassWindows(state: Record<string, unknown>): void {
  if ((state.chain as unknown[]).length === 0 && (state.chainPasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.chainPasses requires a pending chain");
  if ((state.chain as unknown[]).length > 0 && state.status !== "awaiting") throw new Error("Malformed duel snapshot: pending chain requires an awaiting duel");
  if (chainWindowIsActive(state) && state.waitingFor === undefined) throw new Error("Malformed duel snapshot: state.waitingFor is required for a pending chain");
  if ((state.chain as unknown[]).length > 0 && (state.chainPasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.chainPasses must not contain both players");
  if ((state.chain as unknown[]).length > 0 && state.waitingFor !== undefined && (state.chainPasses as PlayerId[]).includes(state.waitingFor as PlayerId)) throw new Error("Malformed duel snapshot: state.waitingFor must not be included in chainPasses");
}

function chainWindowIsActive(state: Record<string, unknown>): boolean {
  return state.status === "awaiting" && state.prompt === undefined && (state.chain as unknown[]).length > 0;
}

function assertSnapshotPromptWindow(state: Record<string, unknown>): void {
  if (!isRecord(state.prompt)) return;
  if ((state.chain as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.prompt must not overlap a pending chain");
  if ((state.pendingTriggers as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.prompt must not overlap pending triggers");
  if (state.waitingFor !== state.prompt.player) throw new Error("Malformed duel snapshot: state.waitingFor must match prompt.player");
}

function assertSnapshotTriggerWindow(state: Record<string, unknown>): void {
  const pendingTriggers = state.pendingTriggers as PendingTrigger[];
  if (state.prompt !== undefined || (state.chain as unknown[]).length > 0 || pendingTriggers.length === 0) return;
  if (state.status !== "awaiting") throw new Error("Malformed duel snapshot: pending trigger window requires an awaiting duel");
  const activeBucket = pendingTriggerBuckets(pendingTriggers)[0];
  if (activeBucket && state.waitingFor !== activeBucket.player) throw new Error("Malformed duel snapshot: state.waitingFor must match active trigger bucket player");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
