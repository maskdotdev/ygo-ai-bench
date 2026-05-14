import type { DuelOptions, DuelPlayerDeck, PlayerId } from "#duel/types.js";
import { isRecord, isSafeCount, isSafeString } from "./parity-validation.js";

const OPTION_KEYS = ["seed", "startingLifePoints", "startingHandSize", "drawPerTurn", "duelTypeFlags"];
const NUMERIC_OPTION_KEYS = ["startingLifePoints", "startingHandSize", "drawPerTurn", "duelTypeFlags"] as const;

export function malformedFixtureOptionsExpectations(options: DuelOptions | undefined): string[] {
  if (options === undefined) return [];
  if (!isRecord(options)) return [`Expected options has malformed value ${String(options)}`];
  const failures: string[] = [];
  for (const key of NUMERIC_OPTION_KEYS) {
    const value = options[key];
    if (value !== undefined && (typeof value !== "number" || !isSafeCount(value))) failures.push(`Expected options.${key} has malformed value ${String(value)}`);
  }
  if (options.seed !== undefined && !isSafeSeed(options.seed)) failures.push(`Expected options.seed has malformed value ${String(options.seed)}`);
  for (const key of Object.keys(options)) if (!OPTION_KEYS.includes(key)) failures.push(`Expected options has malformed key ${key}`);
  return failures;
}

export function malformedFixtureDeckExpectations(decks: Record<PlayerId, DuelPlayerDeck>): string[] {
  if (!isRecord(decks)) return [`Expected decks has malformed value ${String(decks)}`];
  const failures: string[] = [];
  for (const player of [0, 1] as const) {
    const deck = decks[player];
    const description = `decks.${player}`;
    if (!isRecord(deck)) {
      failures.push(`Expected ${description} has malformed value ${String(deck)}`);
      continue;
    }
    validateDeckList(`${description}.main`, deck.main, failures);
    if (deck.extra !== undefined) validateDeckList(`${description}.extra`, deck.extra, failures);
    for (const key of Object.keys(deck)) if (key !== "main" && key !== "extra") failures.push(`Expected ${description} has malformed key ${key}`);
  }
  return failures;
}

function isSafeSeed(value: unknown): boolean {
  return isSafeString(value as string) || (typeof value === "number" && isSafeCount(value));
}

function validateDeckList(description: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) {
    failures.push(`Expected ${description} has malformed value ${String(value)}`);
    return;
  }
  value.forEach((code, index) => {
    if (!isSafeString(code as string)) failures.push(`Expected ${description}[${index}] has malformed value ${String(code)}`);
  });
}
