import { isDuelEventName } from "#duel/event-names.js";
import { isTriggerBucket } from "#duel/trigger-buckets.js";
import type { PendingTrigger, TriggerTiming } from "#duel/types.js";
import { malformedEventCardStateExpectation, matchesEventCardState } from "./parity-event-state-validation.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

const TRIGGER_TIMINGS = new Set<TriggerTiming>(["if", "when"]);
const PENDING_TRIGGER_KEYS = new Set([
  "id", "player", "sourceUid", "effectId", "eventName", "triggerBucket", "eventCode", "eventPlayer", "eventValue", "eventReason", "eventReasonPlayer", "eventReasonCardUid",
  "eventReasonEffectId", "relatedEffectId", "eventChainDepth", "eventChainLinkId", "eventUids", "eventCardUid", "eventPreviousState", "eventCurrentState", "eventTriggerTiming",
  "effectLabelObjectUid", "effectLabelObjectUids",
]);

export function assertPendingTriggerExpectations(actual: PendingTrigger[], expected: Array<Partial<PendingTrigger>> | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected pendingTriggers has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedPendingTriggerExpectation(partial, `pendingTriggers[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected pendingTriggers length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected pendingTriggers[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function malformedPendingTriggerExpectation(partial: Partial<PendingTrigger>, description: string): string[] {
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  const failures: string[] = [];
  for (const key of Object.keys(partial)) if (!PENDING_TRIGGER_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  checkString(failures, description, partial, ["id", "sourceUid", "effectId", "eventReasonCardUid", "eventChainLinkId", "eventCardUid", "effectLabelObjectUid"]);
  checkNumber(failures, description, partial, ["eventCode", "eventValue", "eventReason", "eventReasonEffectId", "relatedEffectId", "eventChainDepth"]);
  if (partial.player !== undefined && !isSafePlayerId(partial.player)) failures.push(`Expected ${description}.player has malformed player ${String(partial.player)}`);
  if (partial.eventPlayer !== undefined && !isSafePlayerId(partial.eventPlayer)) failures.push(`Expected ${description}.eventPlayer has malformed player ${String(partial.eventPlayer)}`);
  if (partial.eventReasonPlayer !== undefined && !isSafePlayerId(partial.eventReasonPlayer)) failures.push(`Expected ${description}.eventReasonPlayer has malformed player ${String(partial.eventReasonPlayer)}`);
  if (partial.eventName !== undefined && !isDuelEventName(partial.eventName)) failures.push(`Expected ${description}.eventName has malformed value ${String(partial.eventName)}`);
  if (partial.triggerBucket !== undefined && !isTriggerBucket(partial.triggerBucket)) failures.push(`Expected ${description}.triggerBucket has malformed value ${String(partial.triggerBucket)}`);
  if (partial.eventName !== undefined && partial.eventTriggerTiming === undefined) failures.push(`Expected ${description}.eventTriggerTiming is required when eventName is set`);
  if (partial.eventTriggerTiming !== undefined && !TRIGGER_TIMINGS.has(partial.eventTriggerTiming as TriggerTiming)) failures.push(`Expected ${description}.eventTriggerTiming has malformed value ${String(partial.eventTriggerTiming)}`);
  failures.push(...malformedEventCardStateExpectation(partial.eventPreviousState, `${description}.eventPreviousState`));
  failures.push(...malformedEventCardStateExpectation(partial.eventCurrentState, `${description}.eventCurrentState`));
  checkStringArray(failures, description, partial, "eventUids");
  checkStringArray(failures, description, partial, "effectLabelObjectUids");
  return failures;
}

function checkString(failures: string[], description: string, partial: Partial<PendingTrigger>, keys: Array<keyof PendingTrigger>): void {
  for (const key of keys) if (partial[key] !== undefined && !isSafeString(partial[key] as string)) failures.push(`Expected ${description}.${key} has malformed value ${String(partial[key])}`);
}

function checkNumber(failures: string[], description: string, partial: Partial<PendingTrigger>, keys: Array<keyof PendingTrigger>): void {
  for (const key of keys) if (partial[key] !== undefined && !Number.isSafeInteger(partial[key])) failures.push(`Expected ${description}.${key} has malformed value ${String(partial[key])}`);
}

function checkStringArray(failures: string[], description: string, partial: Partial<PendingTrigger>, key: "eventUids" | "effectLabelObjectUids"): void {
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
    if (key === "eventPreviousState") return matchesEventCardState((actual as PendingTrigger).eventPreviousState, value as PendingTrigger["eventPreviousState"]);
    if (key === "eventCurrentState") return matchesEventCardState((actual as PendingTrigger).eventCurrentState, value as PendingTrigger["eventCurrentState"]);
    if (Array.isArray(value)) {
      const actualValue = (actual as Record<string, unknown>)[key];
      return Array.isArray(actualValue) && actualValue.length === value.length && value.every((entry, index) => actualValue[index] === entry);
    }
    return (actual as Record<string, unknown>)[key] === value;
  });
}
