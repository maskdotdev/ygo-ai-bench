import { isTriggerBucket } from "#duel/trigger-buckets.js";
import type { PendingTriggerBucketState } from "#duel/types.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

export function assertPendingTriggerBucketExpectations(
  actual: PendingTriggerBucketState[],
  expected: Array<Partial<PendingTriggerBucketState>> | undefined,
  fail: (message: string) => void,
): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected pendingTriggerBuckets has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedPendingTriggerBucketExpectation(partial, `pendingTriggerBuckets[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected pendingTriggerBuckets length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPendingTriggerBucket(actual[index], partial)) fail(`Expected pendingTriggerBuckets[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

export function matchesPendingTriggerBucket(actual: PendingTriggerBucketState | undefined, expected: Partial<PendingTriggerBucketState>): boolean {
  if (actual === undefined) return false;
  if (expected.triggerBucket !== undefined && actual.triggerBucket !== expected.triggerBucket) return false;
  if (expected.player !== undefined && actual.player !== expected.player) return false;
  if (expected.triggerIds !== undefined && (actual.triggerIds.length !== expected.triggerIds.length || actual.triggerIds.some((id, index) => id !== expected.triggerIds?.[index]))) return false;
  return true;
}

function malformedPendingTriggerBucketExpectation(partial: Partial<PendingTriggerBucketState>, description: string): string[] {
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  const failures: string[] = [];
  for (const key of Object.keys(partial)) {
    if (!["triggerBucket", "player", "triggerIds"].includes(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  }
  if (partial.triggerBucket !== undefined && !isTriggerBucket(partial.triggerBucket)) failures.push(`Expected ${description}.triggerBucket has malformed value ${String(partial.triggerBucket)}`);
  if (partial.player !== undefined && !isSafePlayerId(partial.player)) failures.push(`Expected ${description}.player has malformed player ${String(partial.player)}`);
  if (partial.triggerIds !== undefined) {
    if (!Array.isArray(partial.triggerIds)) {
      failures.push(`Expected ${description}.triggerIds has malformed value ${String(partial.triggerIds)}`);
    } else {
      partial.triggerIds.forEach((triggerId, index) => {
        if (!isSafeString(triggerId)) failures.push(`Expected ${description}.triggerIds[${index}] has malformed value ${String(triggerId)}`);
      });
    }
  }
  return failures;
}
