import type { DuelLogEntry } from "#duel/types.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

const LOG_KEYS = new Set(["step", "action", "player", "card", "detail"]);

export function assertLogIncludes(actual: DuelLogEntry[], expected: string[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected logIncludes has malformed value ${String(expected)}`);
  for (const [index, expectedLog] of expected.entries()) {
    if (!isSafeString(expectedLog)) {
      fail(`Expected logIncludes[${index}] has malformed value ${String(expectedLog)}`);
      continue;
    }
    if (!actual.some((entry) => entry.detail.includes(expectedLog) || entry.action.includes(expectedLog))) fail(`Expected log containing ${expectedLog}`);
  }
}

export function assertLogExpectations(actual: DuelLogEntry[], expected: Array<Partial<DuelLogEntry>> | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected log has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedLogExpectation(partial, `log[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected log length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected log[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function malformedLogExpectation(partial: Partial<DuelLogEntry>, description: string): string[] {
  const failures: string[] = [];
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  for (const key of Object.keys(partial)) if (!LOG_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  if (partial.step !== undefined && !Number.isSafeInteger(partial.step)) failures.push(`Expected ${description}.step has malformed value ${String(partial.step)}`);
  if (partial.action !== undefined && !isSafeString(partial.action)) failures.push(`Expected ${description}.action has malformed value ${String(partial.action)}`);
  if (partial.player !== undefined && !isSafePlayerId(partial.player)) failures.push(`Expected ${description}.player has malformed player ${String(partial.player)}`);
  if (partial.card !== undefined && !isSafeString(partial.card)) failures.push(`Expected ${description}.card has malformed value ${String(partial.card)}`);
  if (partial.detail !== undefined && !isSafeString(partial.detail)) failures.push(`Expected ${description}.detail has malformed value ${String(partial.detail)}`);
  return failures;
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
}
