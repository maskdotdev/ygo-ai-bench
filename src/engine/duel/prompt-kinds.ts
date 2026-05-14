import type { DuelPromptState } from "#duel/types.js";

export const duelPromptTypes: readonly DuelPromptState["type"][] = ["selectOption", "selectYesNo"];

const duelPromptTypeSet = new Set<DuelPromptState["type"]>(duelPromptTypes);

export function isDuelPromptType(value: unknown): value is DuelPromptState["type"] {
  return duelPromptTypeSet.has(value as DuelPromptState["type"]);
}
