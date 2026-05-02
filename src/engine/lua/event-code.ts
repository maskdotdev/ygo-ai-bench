import type { DuelEventName } from "#duel/types.js";
import { duelEventNameFromCode } from "#duel/event-codes.js";

export function triggerEventFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === 34) return undefined;
  return duelEventNameFromCode(code);
}
