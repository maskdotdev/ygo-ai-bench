import { isRecord, isSafeString } from "./parity-validation.js";

export interface BattlePairExpectation {
  attackerUid: string;
  targetUid: string;
}

export function assertBattlePairsForWindow(
  actual: BattlePairExpectation[],
  expected: BattlePairExpectation[] | undefined,
  fail: (message: string) => void,
): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected battlePairs has malformed value ${String(expected)}`);
  for (const [index, pair] of expected.entries()) {
    if (!isRecord(pair)) return void fail(`Expected battlePairs[${index}] has malformed value ${String(pair)}`);
    if (!isSafeString(pair.attackerUid)) return void fail(`Expected battlePairs[${index}].attackerUid has malformed value ${String(pair.attackerUid)}`);
    if (!isSafeString(pair.targetUid)) return void fail(`Expected battlePairs[${index}].targetUid has malformed value ${String(pair.targetUid)}`);
  }
  if (actual.length !== expected.length || actual.some((pair, index) => pair.attackerUid !== expected[index]?.attackerUid || pair.targetUid !== expected[index]?.targetUid)) {
    fail(`Expected battlePairs ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
