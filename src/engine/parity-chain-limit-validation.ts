import type { ChainLimit } from "#duel/types.js";
import { isRecord, isSafeString } from "./parity-validation.js";

type ChainLimitExpectation = Partial<Pick<ChainLimit, "registryKey" | "untilChainEnd" | "expiresAtChainLength">>;

const CHAIN_LIMIT_KEYS = new Set(["registryKey", "untilChainEnd", "expiresAtChainLength"]);

export function assertChainLimitExpectations(actual: ChainLimitExpectation[], expected: ChainLimitExpectation[] | undefined, fail: (message: string) => void): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected chainLimits has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((partial, index) => {
    for (const failure of malformedChainLimitExpectation(partial, `chainLimits[${index}]`)) {
      fail(failure);
      malformed = true;
    }
  });
  if (malformed) return;
  if (actual.length !== expected.length) {
    fail(`Expected chainLimits length ${expected.length}, got ${actual.length}`);
    return;
  }
  expected.forEach((partial, index) => {
    if (!matchesPartial(actual[index], partial)) fail(`Expected chainLimits[${index}] ${JSON.stringify(partial)}, got ${JSON.stringify(actual[index])}`);
  });
}

function malformedChainLimitExpectation(partial: ChainLimitExpectation, description: string): string[] {
  if (!isRecord(partial)) return [`Expected ${description} has malformed value ${String(partial)}`];
  const failures: string[] = [];
  for (const key of Object.keys(partial)) if (!CHAIN_LIMIT_KEYS.has(key)) failures.push(`Expected ${description} has malformed key ${key}`);
  if (partial.registryKey !== undefined && !isSafeString(partial.registryKey)) failures.push(`Expected ${description}.registryKey has malformed value ${String(partial.registryKey)}`);
  if (partial.untilChainEnd !== undefined && typeof partial.untilChainEnd !== "boolean") failures.push(`Expected ${description}.untilChainEnd has malformed value ${String(partial.untilChainEnd)}`);
  if (partial.expiresAtChainLength !== undefined && (!Number.isSafeInteger(partial.expiresAtChainLength) || partial.expiresAtChainLength < 0)) {
    failures.push(`Expected ${description}.expiresAtChainLength has malformed value ${String(partial.expiresAtChainLength)}`);
  }
  return failures;
}

function matchesPartial(actual: ChainLimitExpectation | undefined, expected: ChainLimitExpectation): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
}
