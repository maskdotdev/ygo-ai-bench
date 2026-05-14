import type { DuelActivityCounts, PlayerId } from "#duel/types.js";
import { isRecord, isSafeCount, isSafePlayerId, isSafePlayerKey, isSafeString } from "./parity-validation.js";

type Fail = (message: string) => void;
const ACTIVITY_COUNT_KEYS = new Set<keyof DuelActivityCounts>(["summon", "normalSummon", "specialSummon", "flipSummon", "attack"]);

export function assertStringListForWindow(name: string, actual: string[], expected: string[] | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected ${name} has malformed value ${String(expected)}`);
  for (const [index, value] of expected.entries()) if (!isSafeString(value)) return void fail(`Expected ${name}[${index}] has malformed value ${String(value)}`);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertPlayerListForWindow(name: string, actual: PlayerId[], expected: PlayerId[] | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected ${name} has malformed value ${String(expected)}`);
  for (const [index, player] of expected.entries()) if (!isSafePlayerId(player)) return void fail(`Expected ${name}[${index}] has malformed player ${player}`);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertNumberListForWindow(name: string, actual: number[], expected: number[] | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected ${name} has malformed value ${String(expected)}`);
  for (const [index, value] of expected.entries()) if (!isSafeCount(value)) return void fail(`Expected ${name}[${index}] has malformed value ${value}`);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`Expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertPlayerNumberMapForWindow(name: string, actual: Record<PlayerId, number>, expected: Partial<Record<PlayerId, number>> | undefined, fail: Fail): void {
  if (expected !== undefined && !isRecord(expected)) return void fail(`Expected ${name} has malformed value ${String(expected)}`);
  for (const [player, expectedValue] of Object.entries(expected ?? {}) as [string, number][]) {
    if (!isSafePlayerKey(player)) { fail(`Expected ${name} has malformed player ${player}`); continue; }
    if (!isSafeCount(expectedValue)) { fail(`Expected ${name}[${player}] has malformed value ${expectedValue}`); continue; }
    const actualValue = actual[Number(player) as PlayerId] ?? 0;
    if (actualValue !== expectedValue) fail(`Expected ${name}[${player}] ${expectedValue}, got ${actualValue}`);
  }
}

export function assertActivityCountsForWindow(actual: Record<PlayerId, unknown>, expected: Partial<Record<PlayerId, Record<string, number>>> | undefined, fail: Fail): void {
  if (expected !== undefined && !isRecord(expected)) return void fail("Expected activityCounts has malformed value " + String(expected));
  for (const [player, expectedCounts] of Object.entries(expected ?? {}) as [string, Record<string, number>][]) {
    if (!isSafePlayerKey(player)) { fail(`Expected activityCounts has malformed player ${player}`); continue; }
    if (!isRecord(expectedCounts)) { fail(`Expected player ${player} activityCounts has malformed value ${String(expectedCounts)}`); continue; }
    const actualCounts = actual[Number(player) as PlayerId] as Record<string, number> | undefined;
    for (const [activity, expectedCount] of Object.entries(expectedCounts)) {
      if (!ACTIVITY_COUNT_KEYS.has(activity as keyof DuelActivityCounts)) { fail(`Expected player ${player} activityCounts has malformed activity ${activity}`); continue; }
      if (!isSafeCount(expectedCount)) { fail(`Expected player ${player} activity ${activity} has malformed count ${expectedCount}`); continue; }
      const actualCount = actualCounts?.[activity] ?? 0;
      if (actualCount !== expectedCount) fail(`Expected player ${player} activity ${activity} ${expectedCount}, got ${actualCount}`);
    }
  }
}
