import { isTriggerBucket } from "#duel/trigger-buckets.js";
import type { PendingTriggerBucketState, ScriptedLegalActionGroupExpectation, TriggerOrderPromptState } from "#duel/types.js";
import { isRecord, isSafePlayerId, isSafeString } from "./parity-validation.js";

const GROUP_EXPECTATION_KEYS = new Set(["actions", "count", "key", "label", "player", "triggerBucket", "triggerOrderPrompt", "windowId", "windowKind", "windowToken"]);

export function malformedGroupShapeExpectations(expectation: ScriptedLegalActionGroupExpectation, description: string): string[] {
  const failures: string[] = [];
  for (const key of Object.keys(expectation)) {
    if (!GROUP_EXPECTATION_KEYS.has(key)) failures.push(`${description} has malformed key ${key}`);
  }
  if (expectation.key !== undefined && !isSafeString(expectation.key)) failures.push(`${description} has malformed key ${String(expectation.key)}`);
  if (expectation.label !== undefined && !isSafeString(expectation.label)) failures.push(`${description} has malformed label ${String(expectation.label)}`);
  if (expectation.actions !== undefined && !Array.isArray(expectation.actions)) failures.push(`${description} actions has malformed value ${String(expectation.actions)}`);
  if (Array.isArray(expectation.actions)) {
    for (const [index, action] of expectation.actions.entries()) {
      if (!isRecord(action)) failures.push(`${description} actions[${index}] has malformed value ${String(action)}`);
    }
  }
  const triggerBucket = expectation.triggerBucket as Partial<PendingTriggerBucketState> | undefined;
  if (triggerBucket !== undefined) {
    if (!isRecord(triggerBucket)) {
      failures.push(`${description} triggerBucket has malformed value ${String(triggerBucket)}`);
    } else {
      for (const key of Object.keys(triggerBucket)) {
        if (!["triggerBucket", "player", "triggerIds"].includes(key)) failures.push(`${description} triggerBucket has malformed key ${key}`);
      }
      if (triggerBucket.triggerBucket !== undefined && !isTriggerBucket(triggerBucket.triggerBucket)) failures.push(`${description} triggerBucket.triggerBucket has malformed value ${String(triggerBucket.triggerBucket)}`);
      if (triggerBucket.player !== undefined && !isSafePlayerId(triggerBucket.player)) failures.push(`${description} triggerBucket.player has malformed player ${String(triggerBucket.player)}`);
      if (triggerBucket.triggerIds !== undefined) {
        if (!Array.isArray(triggerBucket.triggerIds)) {
          failures.push(`${description} triggerBucket.triggerIds has malformed value ${String(triggerBucket.triggerIds)}`);
        } else {
          triggerBucket.triggerIds.forEach((triggerId, index) => {
            if (!isSafeString(triggerId)) failures.push(`${description} triggerBucket.triggerIds[${index}] has malformed value ${String(triggerId)}`);
          });
        }
      }
    }
  }
  const prompt = expectation.triggerOrderPrompt;
  if (prompt !== undefined && prompt !== null) {
    if (!isRecord(prompt)) {
      failures.push(`${description} triggerOrderPrompt has malformed value ${String(prompt)}`);
    } else {
      for (const key of Object.keys(prompt)) {
        if (!["id", "type", "player", "triggerBucket", "triggerIds"].includes(key)) failures.push(`${description} triggerOrderPrompt has malformed key ${key}`);
      }
      if (prompt.id !== undefined && !isSafeString(prompt.id)) failures.push(`${description} triggerOrderPrompt.id has malformed value ${String(prompt.id)}`);
      if (prompt.type !== undefined && prompt.type !== "orderTriggers") failures.push(`${description} triggerOrderPrompt.type has malformed value ${String(prompt.type)}`);
      if (prompt.player !== undefined && !isSafePlayerId(prompt.player)) failures.push(`${description} triggerOrderPrompt.player has malformed player ${String(prompt.player)}`);
      if (prompt.triggerBucket !== undefined && !isTriggerBucket(prompt.triggerBucket)) failures.push(`${description} triggerOrderPrompt.triggerBucket has malformed value ${String(prompt.triggerBucket)}`);
      if (prompt.triggerIds !== undefined) {
        if (!Array.isArray(prompt.triggerIds)) {
          failures.push(`${description} triggerOrderPrompt.triggerIds has malformed value ${String(prompt.triggerIds)}`);
        } else {
          prompt.triggerIds.forEach((triggerId, index) => {
            if (!isSafeString(triggerId)) failures.push(`${description} triggerOrderPrompt.triggerIds[${index}] has malformed value ${String(triggerId)}`);
          });
        }
      }
    }
  }
  return failures;
}

export function matchesTriggerOrderPrompt(actual: TriggerOrderPromptState | undefined, expected: Partial<TriggerOrderPromptState> | null): boolean {
  if (expected === null) return actual === undefined;
  if (actual === undefined) return false;
  if (expected.id !== undefined && actual.id !== expected.id) return false;
  if (expected.type !== undefined && actual.type !== expected.type) return false;
  if (expected.player !== undefined && actual.player !== expected.player) return false;
  if (expected.triggerBucket !== undefined && actual.triggerBucket !== expected.triggerBucket) return false;
  if (expected.triggerIds !== undefined && !sameTriggerIds(actual.triggerIds, expected.triggerIds)) return false;
  return true;
}

function sameTriggerIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((triggerId, index) => triggerId === expected[index]);
}
