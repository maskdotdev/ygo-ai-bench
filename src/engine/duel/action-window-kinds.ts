import type { DuelActionWindowKind } from "#duel/types.js";

export const duelActionWindowKinds: readonly DuelActionWindowKind[] = ["prompt", "chainResponse", "triggerBucket", "battle", "open"];

const duelActionWindowKindSet = new Set<DuelActionWindowKind>(duelActionWindowKinds);

export function isDuelActionWindowKind(value: unknown): value is DuelActionWindowKind {
  return duelActionWindowKindSet.has(value as DuelActionWindowKind);
}
