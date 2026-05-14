import { isCardPosition, isDuelCardKind } from "#duel/card-kinds.js";
import type { ScriptedDuelCardExpectation } from "#duel/types.js";
import { isSafeCount, isSafeLocationKey, isSafePlayerId, isSafeString } from "./parity-validation.js";

const CARD_KEYS = new Set([
  "uid", "code", "name", "kind", "owner", "controller", "location", "sequence", "position", "faceUp", "overlayCount", "counters",
  "reason", "reasonPlayer", "reasonCardUid", "reasonEffectId",
]);
export function assertCardExpectations(cards: Array<{ uid: string }>, expectedCards: ScriptedDuelCardExpectation[] | undefined, fail: (message: string) => void): void {
  if (expectedCards !== undefined && !Array.isArray(expectedCards)) return void fail(`Expected cards has malformed value ${String(expectedCards)}`);
  for (const [index, expectedCard] of (expectedCards ?? []).entries()) {
    const malformed = malformedCardExpectation(expectedCard, `cards[${index}]`);
    if (malformed.length) {
      for (const failure of malformed) fail(failure);
      continue;
    }
    const actualCard = cards.find((card) => card.uid === expectedCard.uid);
    if (!actualCard) {
      fail(`Expected card ${expectedCard.uid}`);
      continue;
    }
    if (!matchesPartial(actualCard, expectedCard)) fail(`Expected card ${expectedCard.uid} ${JSON.stringify(expectedCard)}, got ${JSON.stringify(actualCard)}`);
  }
}

function malformedCardExpectation(card: ScriptedDuelCardExpectation, description: string): string[] {
  if (!isRecord(card)) return [`Expected ${description} has malformed value ${String(card)}`];
  const failures: string[] = [];
  for (const key of Object.keys(card)) if (!CARD_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  if (!isSafeString(card.uid)) failures.push(`Expected ${description}.uid has malformed value ${String(card.uid)}`);
  if (card.code !== undefined && !isSafeString(card.code)) failures.push(`Expected ${description}.code has malformed value ${String(card.code)}`);
  if (card.name !== undefined && !isSafeString(card.name)) failures.push(`Expected ${description}.name has malformed value ${String(card.name)}`);
  if (card.kind !== undefined && !isDuelCardKind(card.kind)) failures.push(`Expected ${description}.kind has malformed value ${String(card.kind)}`);
  if (card.owner !== undefined && !isSafePlayerId(card.owner)) failures.push(`Expected ${description}.owner has malformed player ${String(card.owner)}`);
  if (card.controller !== undefined && !isSafePlayerId(card.controller)) failures.push(`Expected ${description}.controller has malformed player ${String(card.controller)}`);
  if (card.location !== undefined && !isSafeLocationKey(card.location)) failures.push(`Expected ${description}.location has malformed value ${String(card.location)}`);
  if (card.sequence !== undefined && !isSafeCount(card.sequence)) failures.push(`Expected ${description}.sequence has malformed value ${String(card.sequence)}`);
  if (card.position !== undefined && !isCardPosition(card.position)) failures.push(`Expected ${description}.position has malformed value ${String(card.position)}`);
  if (card.faceUp !== undefined && typeof card.faceUp !== "boolean") failures.push(`Expected ${description}.faceUp has malformed value ${String(card.faceUp)}`);
  if (card.overlayCount !== undefined && !isSafeCount(card.overlayCount)) failures.push(`Expected ${description}.overlayCount has malformed value ${String(card.overlayCount)}`);
  checkCounters(failures, description, card.counters);
  if (card.reason !== undefined && !Number.isSafeInteger(card.reason)) failures.push(`Expected ${description}.reason has malformed value ${String(card.reason)}`);
  if (card.reasonPlayer !== undefined && !isSafePlayerId(card.reasonPlayer)) failures.push(`Expected ${description}.reasonPlayer has malformed player ${String(card.reasonPlayer)}`);
  if (card.reasonCardUid !== undefined && !isSafeString(card.reasonCardUid)) failures.push(`Expected ${description}.reasonCardUid has malformed value ${String(card.reasonCardUid)}`);
  if (card.reasonEffectId !== undefined && !Number.isSafeInteger(card.reasonEffectId)) failures.push(`Expected ${description}.reasonEffectId has malformed value ${String(card.reasonEffectId)}`);
  return failures;
}

function checkCounters(failures: string[], description: string, counters: Record<number, number> | undefined): void {
  if (counters === undefined) return;
  if (typeof counters !== "object" || counters === null || Array.isArray(counters)) {
    failures.push(`Expected ${description}.counters has malformed value ${String(counters)}`);
    return;
  }
  for (const [counter, count] of Object.entries(counters)) {
    if (!Number.isSafeInteger(Number(counter))) failures.push(`Expected ${description}.counters has malformed counter ${counter}`);
    if (!isSafeCount(count)) failures.push(`Expected ${description}.counters[${counter}] has malformed value ${String(count)}`);
  }
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => matchesPartialValue((actual as Record<string, unknown>)[key], value));
}

function matchesPartialValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesPartialValue(actual[index], value));
  if (isRecord(expected)) return isRecord(actual) && Object.entries(expected).every(([key, value]) => matchesPartialValue(actual[key], value));
  return actual === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
