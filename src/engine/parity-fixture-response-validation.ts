import { isCardPosition } from "#duel/card-kinds.js";
import { isTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelActionWindowKind, DuelResponse, ScriptedDuelFixture, ScriptedDuelStep, ScriptedResponseSelector } from "#duel/types.js";
import type { ParityFailure } from "./parity.js";
import { malformedWindowSourceExpectations } from "./parity-fixture-validation.js";
import { isRecord, isSafeBoolean, isSafeCount, isSafeLocationKey, isSafePhase, isSafePlayerId, isSafeString, isSafeWindowId, isSafeWindowKind, isSafeWindowToken } from "./parity-validation.js";

const RESPONSE_TYPES = new Set<DuelResponse["type"]>([
  "normalSummon", "tributeSummon", "tributeSet", "fusionSummon", "synchroSummon", "xyzSummon", "linkSummon", "ritualSummon", "pendulumSummon", "setMonster", "setSpellTrap",
  "activateEffect", "specialSummonProcedure", "passChain", "passAttack", "passDamage", "replayAttack", "cancelAttack", "selectOption", "selectYesNo", "activateTrigger",
  "declineTrigger", "flipSummon", "changePosition", "declareAttack", "changePhase", "endTurn",
]);
const SNAPSHOT_RESTORE_VALUES = new Set<NonNullable<ScriptedDuelStep["snapshotRestore"]>>([true, false, "before", "after", "both"]);
const STEP_KEYS = ["response", "before", "after", "snapshotRestore"];
const RESPONSE_KEYS = [
  "type", "player", "windowId", "windowKind", "windowToken", "code", "uid", "tributeUids", "materialUids", "summonUids", "position", "phase", "attackerUid", "targetUid", "directAttack",
  "promptId", "option", "yes", "effectId", "triggerId", "triggerBucket", "location", "label", "labelIncludes", "occurrence",
];

export function fixtureResponseList(value: ScriptedDuelFixture["responses"], failures: ParityFailure[], fixture: string): ScriptedDuelStep[] {
  if (!Array.isArray(value)) {
    failures.push({ fixture, message: `Expected responses has malformed value ${String(value)}` });
    return [];
  }
  return value;
}

export function malformedFixtureResponseExpectations(steps: ScriptedDuelStep[]): string[] {
  const failures: string[] = [];
  for (const [index, step] of steps.entries()) {
    const description = `responses[${index}]`;
    if (!isRecord(step)) {
      failures.push(`${description} has malformed value ${String(step)}`);
      continue;
    }
    if (!isRecord(step.response)) {
      failures.push(`${description}.response has malformed value ${String(step.response)}`);
      continue;
    }
    assertScriptedResponse(`${description}.response`, step.response as Partial<ScriptedResponseSelector>, failures);
    for (const key of ["before", "after"] as const) if (step[key] !== undefined) failures.push(...malformedWindowSourceExpectations(`${description}.${key}`, step[key]));
    if (step.snapshotRestore !== undefined && !SNAPSHOT_RESTORE_VALUES.has(step.snapshotRestore)) failures.push(`${description}.snapshotRestore has malformed value ${String(step.snapshotRestore)}`);
    for (const key of Object.keys(step)) if (!STEP_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
  }
  return failures;
}

function assertScriptedResponse(description: string, response: Partial<ScriptedResponseSelector>, failures: string[]): void {
  if (!RESPONSE_TYPES.has(response.type as DuelResponse["type"])) failures.push(`${description}.type has malformed value ${String(response.type)}`);
  if (!isSafePlayerId(response.player as never)) failures.push(`${description}.player has malformed player ${String(response.player)}`);
  const malformedWindowField = malformedActionWindowField(response);
  if (malformedWindowField) failures.push(`${description}.${malformedWindowField} has malformed value ${String(response[malformedWindowField])}`);
  const malformedSelectorField = malformedActionSelectorField(response);
  if (malformedSelectorField) failures.push(`${description}.${malformedSelectorField} has malformed value ${String(malformedSelectorValue(response, malformedSelectorField))}`);
  for (const key of Object.keys(response)) if (!RESPONSE_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function malformedActionWindowField(response: Partial<ScriptedResponseSelector>): keyof Pick<ScriptedResponseSelector, "windowId" | "windowKind" | "windowToken"> | undefined {
  if (response.windowId !== undefined && !isSafeWindowId(response.windowId)) return "windowId";
  if (response.windowKind !== undefined && !isSafeWindowKind(response.windowKind as DuelActionWindowKind)) return "windowKind";
  if (response.windowToken !== undefined && !isSafeWindowToken(response.windowToken)) return "windowToken";
  return undefined;
}

function malformedActionSelectorField(response: Partial<ScriptedResponseSelector>): string | undefined {
  const raw = response as Record<string, unknown>;
  if (response.code !== undefined && !isSafeString(response.code)) return "code";
  if (response.uid !== undefined && !isSafeString(response.uid)) return "uid";
  if (response.tributeUids !== undefined) return malformedStringListField("tributeUids", response.tributeUids);
  if (response.materialUids !== undefined) return malformedStringListField("materialUids", response.materialUids);
  if (response.summonUids !== undefined) return malformedStringListField("summonUids", response.summonUids);
  if (response.position !== undefined && !isCardPosition(response.position)) return "position";
  if (response.phase !== undefined && !isSafePhase(response.phase)) return "phase";
  if (response.attackerUid !== undefined && !isSafeString(response.attackerUid)) return "attackerUid";
  if (response.targetUid !== undefined && !isSafeString(response.targetUid)) return "targetUid";
  if (response.directAttack !== undefined && !isSafeBoolean(response.directAttack)) return "directAttack";
  if (response.promptId !== undefined && !isSafeWindowToken(response.promptId)) return "promptId";
  if (response.option !== undefined && !isSafeCount(response.option)) return "option";
  if (response.yes !== undefined && !isSafeBoolean(response.yes)) return "yes";
  if (response.effectId !== undefined && !isSafeString(response.effectId)) return "effectId";
  if (response.triggerId !== undefined && !isSafeString(response.triggerId)) return "triggerId";
  if (response.triggerBucket !== undefined && !isTriggerBucket(response.triggerBucket)) return "triggerBucket";
  if (response.location !== undefined && !isSafeLocationKey(response.location)) return "location";
  if (raw.label !== undefined && !isSafeString(raw.label as string)) return "label";
  if (response.labelIncludes !== undefined && !isSafeWindowToken(response.labelIncludes)) return "labelIncludes";
  if (response.occurrence !== undefined && !isSafeCount(response.occurrence)) return "occurrence";
  return undefined;
}

function malformedStringListField(field: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) return field;
  for (const [index, entry] of value.entries()) {
    if (!isSafeString(entry)) return `${field}[${index}]`;
  }
  return undefined;
}

function malformedSelectorValue(response: Partial<ScriptedResponseSelector>, field: string): unknown {
  const listEntry = /^(tributeUids|materialUids|summonUids)\[(\d+)\]$/.exec(field);
  if (!listEntry) return (response as Record<string, unknown>)[field];
  const listField = listEntry[1];
  const listIndex = listEntry[2];
  if (listField === undefined || listIndex === undefined) return undefined;
  const value = (response as Record<string, unknown>)[listField];
  return Array.isArray(value) ? value[Number(listIndex)] : value;
}
