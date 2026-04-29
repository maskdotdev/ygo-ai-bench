import type { DuelCardData } from "#duel/types.js";

export function fallbackCardReader(code: string): DuelCardData {
  return {
    code,
    name: `Card ${code}`,
    kind: "monster",
  };
}
