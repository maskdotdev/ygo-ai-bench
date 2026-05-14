import { isBattleWindowKind } from "#duel/battle-window-state.js";
import { isDuelPromptType } from "#duel/prompt-kinds.js";
import { isTriggerBucket } from "#duel/trigger-buckets.js";
import type { BattleStep, BattleWindowState, DuelOptions, DuelPhase, DuelPromptState, DuelWinner, PlayerId, SkippedDuelPhase, TriggerOrderPromptState } from "#duel/types.js";
import { isSafeBattleStep, isSafeBoolean, isSafeCount, isSafePhase, isSafePlayerId, isSafeString, isSafeWinner } from "./parity-validation.js";

type Fail = (message: string) => void;
const SKIPPED_PHASE_KEYS = new Set(["player", "phase", "remaining"]);

export function assertSafeNumberForWindow(name: string, expected: number | undefined, fail: Fail): expected is number {
  if (expected === undefined) return false;
  if (!isSafeCount(expected)) {
    fail(`Expected ${name} has malformed value ${expected}`);
    return false;
  }
  return true;
}

export function assertSafePlayerForWindow(name: string, expected: PlayerId | undefined, fail: Fail): expected is PlayerId {
  if (expected === undefined) return false;
  if (!isSafePlayerId(expected)) {
    fail(`Expected ${name} has malformed player ${expected}`);
    return false;
  }
  return true;
}

export function assertBooleanForWindow(name: string, actual: boolean, expected: boolean | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!isSafeBoolean(expected)) return void fail(`Expected ${name} has malformed value ${expected}`);
  if (actual !== expected) fail(`Expected ${name} ${expected}, got ${actual}`);
}

export function assertOptionalSafeNumberForWindow(name: string, actual: number | undefined, expected: number | null | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (expected === null) return void assertOptionalValueForWindow(name, actual, expected, fail);
  if (!isSafeCount(expected)) return void fail(`Expected ${name} has malformed value ${expected}`);
  assertOptionalValueForWindow(name, actual, expected, fail);
}

export function assertWinnerForWindow(actual: DuelWinner | undefined, expected: DuelWinner | null | undefined, fail: Fail): void {
  if (expected !== undefined && expected !== null && !isSafeWinner(expected)) return void fail(`Expected winner has malformed value ${expected}`);
  assertOptionalValueForWindow("winner", actual, expected, fail);
}

export function assertOptionsForWindow(actual: Record<string, unknown>, expected: Partial<DuelOptions> | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!isRecord(expected)) return void fail(`Expected options has malformed value ${String(expected)}`);
  let malformed = false;
  for (const [key, value] of Object.entries(expected)) {
    if (key === "seed") {
      if (!isSafeString(value as string) && !isSafeCount(value as number)) {
        fail(`Expected options.seed has malformed value ${String(value)}`);
        malformed = true;
      }
      continue;
    }
    if (key !== "startingLifePoints" && key !== "startingHandSize" && key !== "drawPerTurn" && key !== "duelTypeFlags") {
      fail(`Expected options has malformed key ${key}`);
      malformed = true;
      continue;
    }
    if (!isSafeCount(value as number)) {
      fail(`Expected options.${key} has malformed value ${String(value)}`);
      malformed = true;
    }
  }
  if (!malformed && !matchesPartial(actual, expected)) fail(`Expected options ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertSkippedPhasesForWindow(actual: SkippedDuelPhase[], expected: SkippedDuelPhase[] | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (!Array.isArray(expected)) return void fail(`Expected skippedPhases has malformed value ${String(expected)}`);
  let malformed = false;
  expected.forEach((skip, index) => {
    if (!isRecord(skip)) {
      fail(`Expected skippedPhases[${index}] has malformed value ${String(skip)}`);
      malformed = true;
      return;
    }
    for (const key of Object.keys(skip)) {
      if (!SKIPPED_PHASE_KEYS.has(key)) {
        fail(`Expected skippedPhases[${index}] has malformed key ${key}`);
        malformed = true;
      }
    }
    if (!isSafePlayerId(skip.player)) {
      fail(`Expected skippedPhases[${index}].player has malformed player ${skip.player}`);
      malformed = true;
    }
    if (!isSafePhase(skip.phase as DuelPhase)) {
      fail(`Expected skippedPhases[${index}].phase has malformed value ${skip.phase}`);
      malformed = true;
    }
    if (!isSafeCount(skip.remaining) || skip.remaining === 0) {
      fail(`Expected skippedPhases[${index}].remaining has malformed value ${skip.remaining}`);
      malformed = true;
    }
  });
  if (!malformed && !matchesPartialList(actual, expected)) fail(`Expected skippedPhases ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertBattleWindowForWindow(actual: BattleWindowState | undefined, expected: Partial<BattleWindowState> | null | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) fail(`Expected no battleWindow, got ${JSON.stringify(actual)}`);
    return;
  }
  if (!isRecord(expected)) return void fail(`Expected battleWindow has malformed value ${String(expected)}`);
  let malformed = false;
  for (const [key, value] of Object.entries(expected)) {
    if (key === "id" && !isSafeCount(value as number)) {
      fail(`Expected battleWindow.id has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "kind" && !isBattleWindowKind(value)) {
      fail(`Expected battleWindow.kind has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "step" && !isSafeBattleStep(value as BattleStep)) {
      fail(`Expected battleWindow.step has malformed value ${String(value)}`);
      malformed = true;
    } else if ((key === "attackerUid" || key === "targetUid") && !isSafeString(value as string)) {
      fail(`Expected battleWindow.${key} has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "responsePlayer" && !isSafePlayerId(value as PlayerId)) {
      fail(`Expected battleWindow.responsePlayer has malformed player ${String(value)}`);
      malformed = true;
    } else if (key === "attackNegated" && !isSafeBoolean(value as boolean)) {
      fail(`Expected battleWindow.attackNegated has malformed value ${String(value)}`);
      malformed = true;
    } else if (!["id", "kind", "step", "attackerUid", "targetUid", "responsePlayer", "attackNegated"].includes(key)) {
      fail(`Expected battleWindow has malformed key ${key}`);
      malformed = true;
    }
  }
  if (!malformed && !matchesPartial(actual, expected)) fail(`Expected battleWindow ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertPromptForWindow(actual: DuelPromptState | undefined, expected: Partial<DuelPromptState> | null | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) fail(`Expected no prompt, got ${JSON.stringify(actual)}`);
    return;
  }
  if (!isRecord(expected)) return void fail(`Expected prompt has malformed value ${String(expected)}`);
  let malformed = false;
  for (const [key, value] of Object.entries(expected)) {
    if (key === "id" && !isSafeString(value as string)) {
      fail(`Expected prompt.id has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "type" && !isDuelPromptType(value)) {
      fail(`Expected prompt.type has malformed value ${String(value)}`);
      malformed = true;
    } else if ((key === "player" || key === "returnTo") && !isSafePlayerId(value as PlayerId)) {
      fail(`Expected prompt.${key} has malformed player ${String(value)}`);
      malformed = true;
    } else if (key === "origin" && value !== "luaOperation") {
      fail(`Expected prompt.origin has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "description" && !isSafeCount(value as number)) {
      fail(`Expected prompt.description has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "description" && expected.type === "selectOption") {
      fail("Expected prompt.description has malformed field for selectOption");
      malformed = true;
    } else if (key === "descriptions") {
      if (expected.type === "selectYesNo") {
        fail("Expected prompt.descriptions has malformed field for selectYesNo");
        malformed = true;
        continue;
      }
      if (!Array.isArray(value)) {
        fail(`Expected prompt.descriptions has malformed value ${String(value)}`);
        malformed = true;
      } else if (Array.isArray("options" in expected ? expected.options : undefined) && value.length !== ("options" in expected ? expected.options : undefined)?.length) {
        fail("Expected prompt.descriptions must match options length");
        malformed = true;
      } else {
        value.forEach((description, index) => {
          if (!isSafeCount(description)) {
            fail(`Expected prompt.descriptions[${index}] has malformed value ${String(description)}`);
            malformed = true;
          }
        });
      }
    } else if (key === "options") {
      if (expected.type === "selectYesNo") {
        fail("Expected prompt.options has malformed field for selectYesNo");
        malformed = true;
        continue;
      }
      if (!Array.isArray(value)) {
        fail(`Expected prompt.options has malformed value ${String(value)}`);
        malformed = true;
      } else {
        value.forEach((option, index) => {
          if (!isSafeCount(option)) {
            fail(`Expected prompt.options[${index}] has malformed value ${String(option)}`);
            malformed = true;
          }
        });
      }
    } else if (!["id", "type", "player", "options", "description", "descriptions", "returnTo", "origin"].includes(key)) {
      fail(`Expected prompt has malformed key ${key}`);
      malformed = true;
    }
  }
  if (!malformed && !matchesPartial(actual, expected)) fail(`Expected prompt ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertTriggerOrderPromptForWindow(actual: TriggerOrderPromptState | undefined, expected: Partial<TriggerOrderPromptState> | null | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) fail(`Expected no triggerOrderPrompt, got ${JSON.stringify(actual)}`);
    return;
  }
  if (!isRecord(expected)) return void fail(`Expected triggerOrderPrompt has malformed value ${String(expected)}`);
  let malformed = false;
  for (const [key, value] of Object.entries(expected)) {
    if (key === "id" && !isSafeString(value as string)) {
      fail(`Expected triggerOrderPrompt.id has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "type" && value !== "orderTriggers") {
      fail(`Expected triggerOrderPrompt.type has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "player" && !isSafePlayerId(value as PlayerId)) {
      fail(`Expected triggerOrderPrompt.player has malformed player ${String(value)}`);
      malformed = true;
    } else if (key === "triggerBucket" && !isTriggerBucket(value)) {
      fail(`Expected triggerOrderPrompt.triggerBucket has malformed value ${String(value)}`);
      malformed = true;
    } else if (key === "triggerIds") {
      if (!Array.isArray(value)) {
        fail(`Expected triggerOrderPrompt.triggerIds has malformed value ${String(value)}`);
        malformed = true;
      } else {
        value.forEach((triggerId, index) => {
          if (!isSafeString(triggerId)) {
            fail(`Expected triggerOrderPrompt.triggerIds[${index}] has malformed value ${String(triggerId)}`);
            malformed = true;
          }
        });
      }
    } else if (!["id", "type", "player", "triggerBucket", "triggerIds"].includes(key)) {
      fail(`Expected triggerOrderPrompt has malformed key ${key}`);
      malformed = true;
    }
  }
  if (!malformed && !matchesPartial(actual, expected)) fail(`Expected triggerOrderPrompt ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertOptionalValueForWindow<T>(name: string, actual: T | undefined, expected: T | null | undefined, fail: Fail): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) fail(`Expected no ${name}, got ${String(actual)}`);
    return;
  }
  if (actual !== expected) fail(`Expected ${name} ${String(expected)}, got ${String(actual)}`);
}

function matchesPartialList<T extends object>(actual: T[], expected: Partial<T>[]): boolean {
  return actual.length === expected.length && expected.every((partial, index) => matchesPartial(actual[index], partial));
}

function matchesPartial<T extends object>(actual: T | undefined, expected: Partial<T>): boolean {
  if (actual === undefined) return false;
  return Object.entries(expected).every(([key, value]) => matchesPartialValue((actual as Record<string, unknown>)[key], value));
}

function matchesPartialValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesPartialValue(actual[index], value));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) => matchesPartialValue(actual[key], value));
  }
  return actual === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
