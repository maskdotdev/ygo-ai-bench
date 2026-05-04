import { assertSnapshotBattleStateConsistency, assertSnapshotBattleWindowContext } from "#duel/snapshot-battle-validation.js";
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
