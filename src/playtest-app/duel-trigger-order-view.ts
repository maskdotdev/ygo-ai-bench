import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { TriggerOrderPromptState } from "#duel/types.js";

export interface DuelTriggerOrderView {
  label: string;
  detail: string;
  groups: DuelLegalActionGroup[];
}

export function duelTriggerOrderView(
  prompt: TriggerOrderPromptState | undefined,
  groups: readonly DuelLegalActionGroup[] | undefined,
): DuelTriggerOrderView | undefined {
  if (!prompt) return undefined;
  const promptGroups = (groups ?? []).filter((group) => groupMatchesTriggerOrder(group, prompt));
  if (!promptGroups.length) return undefined;
  return {
    label: "Trigger Order",
    detail: `P${prompt.player + 1} · ${prompt.triggerBucket} · ${prompt.triggerIds.length} triggers`,
    groups: promptGroups,
  };
}

function groupMatchesTriggerOrder(group: DuelLegalActionGroup, prompt: TriggerOrderPromptState): boolean {
  if (group.triggerOrderPrompt?.id === prompt.id) return true;
  return (
    group.windowKind === "triggerBucket" &&
    group.triggerBucket?.player === prompt.player &&
    group.triggerBucket.triggerBucket === prompt.triggerBucket &&
    group.triggerBucket.triggerIds.some((id) => prompt.triggerIds.includes(id))
  );
}
