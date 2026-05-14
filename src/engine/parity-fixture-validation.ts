import { isRecord, isSafeString } from "./parity-validation.js";

const FIXTURE_KEYS = ["name", "options", "decks", "setup", "before", "responses", "expected"];
const SETUP_KEYS = ["moveCards", "effects", "collectEvents", "prompt"];
const WINDOW_KEYS = [
  "source", "note", "status", "winner", "winReason", "windowId", "windowKind", "waitingFor", "turn", "turnPlayer", "phase", "randomCounter", "lastDiceResults", "lastCoinResults", "lifePoints", "activityCounts", "activityHistory", "skippedPhases", "phaseActivity", "battleDamage", "attackCostPaid", "options", "duelTypeFlags", "globalFlags", "unofficialProcEnabled", "shuffleCheckDisabled", "usedCountKeys", "battleStep", "battleWindow", "pendingBattle", "currentAttack", "chainLimits", "chainPasses", "attackPasses", "damagePasses", "chain", "pendingTriggers", "pendingTriggerBuckets", "eventHistory", "prompt", "triggerOrderPrompt", "legalActionCounts", "legalActionGroupCounts", "legalActions", "legalActionGroups", "absentLegalActions", "absentLegalActionGroups", "locations", "locationCounts", "cards", "positionsChanged", "attacksDeclared", "attackCanceledUids", "attackedTargetUids", "battlePairs", "logCount", "log", "logIncludes",
];
const optionalRecordFields = ["setup", "before"] as const;

export function fixtureNameForFailure(fixture: unknown): string {
  return isRecord(fixture) && isSafeString(fixture.name as string) ? fixture.name as string : "<malformed fixture>";
}

export function malformedFixtureExpectations(fixture: unknown): string[] {
  if (!isRecord(fixture)) return [`Expected fixture has malformed value ${String(fixture)}`];
  const failures: string[] = [];
  if (!isSafeString(fixture.name as string)) failures.push(`Expected fixture.name has malformed value ${String(fixture.name)}`);
  for (const key of optionalRecordFields) if (fixture[key] !== undefined && !isRecord(fixture[key])) failures.push(`Expected fixture.${key} has malformed value ${String(fixture[key])}`);
  if (!isRecord(fixture.expected)) failures.push(`Expected fixture.expected has malformed value ${String(fixture.expected)}`);
  if (isRecord(fixture.setup)) for (const key of Object.keys(fixture.setup)) if (!SETUP_KEYS.includes(key)) failures.push(`Expected fixture.setup has malformed key ${key}`);
  if (isRecord(fixture.before)) assertWindowSource("fixture.before", fixture.before, failures);
  if (isRecord(fixture.expected)) assertWindowSource("fixture.expected", fixture.expected, failures);
  for (const key of Object.keys(fixture)) if (!FIXTURE_KEYS.includes(key)) failures.push(`Expected fixture has malformed key ${key}`);
  return failures;
}

export function malformedWindowSourceExpectations(description: string, value: unknown): string[] {
  if (!isRecord(value)) return [`Expected ${description} has malformed value ${String(value)}`];
  const failures: string[] = [];
  assertWindowSource(description, value, failures);
  return failures;
}

export function malformedWindowShapeExpectations(value: object): string[] {
  const failures: string[] = [];
  for (const key of Object.keys(value)) if (!WINDOW_KEYS.includes(key)) failures.push(`Expected window has malformed key ${key}`);
  return failures;
}

function assertWindowSource(description: string, value: Record<string, unknown>, failures: string[]): void {
  if (value.source !== "edopro" && value.source !== "parity-backlog") failures.push(`Expected ${description}.source has malformed value ${String(value.source)}`);
  if (value.note !== undefined && !isSafeString(value.note as string)) failures.push(`Expected ${description}.note has malformed value ${String(value.note)}`);
  if (value.source === "parity-backlog" && !isSafeString(value.note as string)) failures.push(`Expected ${description}.note has malformed value ${String(value.note)}`);
}
