import type { DuelPromptState } from "#duel/types.js";
import type { DuelActionUiGroup } from "./duel-action-anchors.js";

export interface DuelPromptView {
  label: string;
  detail: string;
  groups: DuelActionUiGroup[];
}

export interface SplitPromptGroups {
  promptGroups: DuelActionUiGroup[];
  globalGroups: DuelActionUiGroup[];
}

export function promptViewLabel(prompt: DuelPromptState): string {
  switch (prompt.type) {
    case "selectOption":
      return "Option Prompt";
    case "selectYesNo":
      return "Yes / No Prompt";
  }
  const exhaustive: never = prompt;
  return exhaustive;
}

export function promptViewDetail(prompt: DuelPromptState): string {
  const parts = [`P${prompt.player + 1}`, `Prompt ${prompt.id}`];
  if (prompt.returnTo !== undefined) parts.push(`returns P${prompt.returnTo + 1}`);

  switch (prompt.type) {
    case "selectOption": {
      parts.push(`options ${prompt.options.join(", ")}`);
      if (prompt.descriptions?.length) parts.push(`text ${prompt.descriptions.join(", ")}`);
      break;
    }
    case "selectYesNo": {
      if (prompt.description !== undefined) parts.push(`text ${prompt.description}`);
      break;
    }
  }

  return parts.join(" · ");
}

export function splitPromptGroups(prompt: DuelPromptState | undefined, groups: readonly DuelActionUiGroup[]): SplitPromptGroups {
  if (!prompt) return { promptGroups: [], globalGroups: [...groups] };

  const promptGroups: DuelActionUiGroup[] = [];
  const globalGroups: DuelActionUiGroup[] = [];
  for (const group of groups) {
    if (group.promptId === prompt.id && group.promptType === prompt.type) {
      promptGroups.push(group);
    } else {
      globalGroups.push(group);
    }
  }
  return { promptGroups, globalGroups };
}

export function duelPromptView(prompt: DuelPromptState | undefined, groups: readonly DuelActionUiGroup[]): DuelPromptView | undefined {
  if (!prompt) return undefined;
  const { promptGroups } = splitPromptGroups(prompt, groups);
  if (!promptGroups.length) return undefined;
  return {
    label: promptViewLabel(prompt),
    detail: promptViewDetail(prompt),
    groups: promptGroups,
  };
}
