import { isCardPosition } from "#duel/card-kinds.js";
import type { DuelEventCardState } from "#duel/types.js";
import { isSafeCount, isSafeLocationKey, isSafePlayerId } from "./parity-validation.js";

const EVENT_CARD_STATE_KEYS = new Set(["controller", "location", "sequence", "position", "faceUp"]);

export function malformedEventCardStateExpectation(value: Partial<DuelEventCardState> | undefined, description: string): string[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`Expected ${description} has malformed value ${String(value)}`];
  const failures: string[] = [];
  for (const key of Object.keys(value)) if (!EVENT_CARD_STATE_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  if (value.controller !== undefined && !isSafePlayerId(value.controller)) failures.push(`Expected ${description}.controller has malformed player ${String(value.controller)}`);
  if (value.location !== undefined && !isSafeLocationKey(value.location)) failures.push(`Expected ${description}.location has malformed value ${String(value.location)}`);
  if (value.sequence !== undefined && !isSafeCount(value.sequence)) failures.push(`Expected ${description}.sequence has malformed value ${String(value.sequence)}`);
  if (value.position !== undefined && !isCardPosition(value.position)) failures.push(`Expected ${description}.position has malformed value ${String(value.position)}`);
  if (value.faceUp !== undefined && typeof value.faceUp !== "boolean") failures.push(`Expected ${description}.faceUp has malformed value ${String(value.faceUp)}`);
  return failures;
}

export function matchesEventCardState(actual: DuelEventCardState | undefined, expected: Partial<DuelEventCardState> | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  if (expected.controller !== undefined && actual.controller !== expected.controller) return false;
  if (expected.location !== undefined && actual.location !== expected.location) return false;
  if (expected.sequence !== undefined && actual.sequence !== expected.sequence) return false;
  if (expected.position !== undefined && actual.position !== expected.position) return false;
  if (expected.faceUp !== undefined && actual.faceUp !== expected.faceUp) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
