import { isDuelEventName } from "#duel/event-names.js";
import type { DuelEventRecord } from "#duel/types.js";
import { malformedEventCardStateExpectation, matchesEventCardState } from "./parity-event-state-validation.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

const EVENT_HISTORY_KEYS = new Set([
  "eventName", "eventCode", "eventPlayer", "eventValue", "eventReason", "eventReasonPlayer", "eventReasonCardUid", "eventReasonEffectId", "relatedEffectId", "eventChainDepth",
  "eventChainLinkId", "eventUids", "eventCardUid", "eventPreviousState", "eventCurrentState",
]);

export function assertEventHistoryExpectations(actual: DuelEventRecord[], expected: Array<Partial<DuelEventRecord>> | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected eventHistory has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedEventHistoryExpectation(partial, `eventHistory[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected eventHistory length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected eventHistory[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function malformedEventHistoryExpectation(partial: Partial<DuelEventRecord>, description: string): string[] {
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  const failures: string[] = [];
  for (const key of Object.keys(partial)) if (!EVENT_HISTORY_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  checkString(failures, description, partial, ["eventReasonCardUid", "eventChainLinkId", "eventCardUid"]);
  checkNumber(failures, description, partial, ["eventCode", "eventValue", "eventReason", "eventReasonEffectId", "relatedEffectId", "eventChainDepth"]);
  if (partial.eventPlayer !== undefined && !isSafePlayerId(partial.eventPlayer)) failures.push(`Expected ${description}.eventPlayer has malformed player ${String(partial.eventPlayer)}`);
  if (partial.eventReasonPlayer !== undefined && !isSafePlayerId(partial.eventReasonPlayer)) failures.push(`Expected ${description}.eventReasonPlayer has malformed player ${String(partial.eventReasonPlayer)}`);
  if (partial.eventName !== undefined && !isDuelEventName(partial.eventName)) failures.push(`Expected ${description}.eventName has malformed value ${String(partial.eventName)}`);
  failures.push(...malformedEventCardStateExpectation(partial.eventPreviousState, `${description}.eventPreviousState`));
  failures.push(...malformedEventCardStateExpectation(partial.eventCurrentState, `${description}.eventCurrentState`));
  checkStringArray(failures, description, partial, "eventUids");
  return failures;
}

function checkString(failures: string[], description: string, partial: Partial<DuelEventRecord>, keys: Array<keyof DuelEventRecord>): void {
  for (const key of keys) if (partial[key] !== undefined && !isSafeString(partial[key] as string)) failures.push(`Expected ${description}.${key} has malformed value ${String(partial[key])}`);
}

function checkNumber(failures: string[], description: string, partial: Partial<DuelEventRecord>, keys: Array<keyof DuelEventRecord>): void {
  for (const key of keys) if (partial[key] !== undefined && !Number.isSafeInteger(partial[key])) failures.push(`Expected ${description}.${key} has malformed value ${String(partial[key])}`);
}

function checkStringArray(failures: string[], description: string, partial: Partial<DuelEventRecord>, key: "eventUids"): void {
  const value = partial[key];
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    failures.push(`Expected ${description}.${key} has malformed value ${String(value)}`);
    return;
  }
  value.forEach((entry, index) => {
    if (!isSafeString(entry)) failures.push(`Expected ${description}.${key}[${index}] has malformed value ${String(entry)}`);
  });
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => {
    if (key === "eventPreviousState") return matchesEventCardState((actual as DuelEventRecord).eventPreviousState, value as DuelEventRecord["eventPreviousState"]);
    if (key === "eventCurrentState") return matchesEventCardState((actual as DuelEventRecord).eventCurrentState, value as DuelEventRecord["eventCurrentState"]);
    if (Array.isArray(value)) {
      const actualValue = (actual as Record<string, unknown>)[key];
      return Array.isArray(actualValue) && actualValue.length === value.length && value.every((entry, index) => actualValue[index] === entry);
    }
    return (actual as Record<string, unknown>)[key] === value;
  });
}
