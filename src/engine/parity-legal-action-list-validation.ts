import type { ScriptedLegalActionExpectation, ScriptedLegalActionGroupExpectation } from "#duel/types.js";
import { isRecord } from "./parity-validation.js";

export function legalActionExpectationList(name: string, expected: ScriptedLegalActionExpectation[] | undefined, fail: (message: string) => void): ScriptedLegalActionExpectation[] {
  if (expected === undefined) return [];
  if (!Array.isArray(expected)) {
    fail(`Expected ${name} has malformed value ${String(expected)}`);
    return [];
  }
  return expected.filter((entry, index) => {
    if (isRecord(entry)) return true;
    fail(`Expected ${name}[${index}] has malformed value ${String(entry)}`);
    return false;
  }) as ScriptedLegalActionExpectation[];
}

export function legalActionGroupExpectationList(name: string, expected: ScriptedLegalActionGroupExpectation[] | undefined, fail: (message: string) => void): ScriptedLegalActionGroupExpectation[] {
  if (expected === undefined) return [];
  if (!Array.isArray(expected)) {
    fail(`Expected ${name} has malformed value ${String(expected)}`);
    return [];
  }
  return expected.filter((entry, index) => {
    if (isRecord(entry)) return true;
    fail(`Expected ${name}[${index}] has malformed value ${String(entry)}`);
    return false;
  }) as ScriptedLegalActionGroupExpectation[];
}
