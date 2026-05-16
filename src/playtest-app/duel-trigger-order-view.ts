import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { TriggerOrderPromptState } from "#duel/types.js";
import { copyDuelLegalActionGroup } from "./duel-action-anchors.js";

export interface DuelTriggerOrderView {
  label: string;
  detail: string;
  prompt: TriggerOrderPromptState;
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
    prompt: copyTriggerOrderPrompt(prompt),
    groups: promptGroups,
  };
}

export function copyDuelTriggerOrderView(view: DuelTriggerOrderView): DuelTriggerOrderView {
  return {
    ...view,
    prompt: copyTriggerOrderPrompt(view.prompt),
    groups: view.groups.map(copyDuelLegalActionGroup),
  };
}

function copyTriggerOrderPrompt(prompt: TriggerOrderPromptState): TriggerOrderPromptState {
  return {
    ...prompt,
    triggerIds: [...prompt.triggerIds],
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
