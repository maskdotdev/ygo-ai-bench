import type { DuelActivityRecord } from "#duel/types.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

const ACTIVITY_HISTORY_KEYS = new Set(["player", "activity", "cardUid", "effectId"]);

export function assertActivityHistoryExpectations(actual: DuelActivityRecord[], expected: Array<Partial<DuelActivityRecord>> | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected activityHistory has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedActivityHistoryExpectation(partial, `activityHistory[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected activityHistory length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected activityHistory[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function malformedActivityHistoryExpectation(partial: Partial<DuelActivityRecord>, description: string): string[] {
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  const failures: string[] = [];
  for (const key of Object.keys(partial)) if (!ACTIVITY_HISTORY_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  if (partial.player !== undefined && !isSafePlayerId(partial.player)) failures.push(`Expected ${description}.player has malformed player ${String(partial.player)}`);
  if (partial.activity !== undefined && !Number.isSafeInteger(partial.activity)) failures.push(`Expected ${description}.activity has malformed value ${String(partial.activity)}`);
  if (partial.cardUid !== undefined && !isSafeString(partial.cardUid)) failures.push(`Expected ${description}.cardUid has malformed value ${String(partial.cardUid)}`);
  if (partial.effectId !== undefined && !isSafeString(partial.effectId)) failures.push(`Expected ${description}.effectId has malformed value ${String(partial.effectId)}`);
  return failures;
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
}
