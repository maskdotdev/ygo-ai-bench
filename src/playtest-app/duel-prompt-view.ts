import { copyDuelAction } from "#duel/action-copy.js";
import type { DuelAction, DuelPromptState } from "#duel/types.js";
import type { DuelActionUiGroup } from "./duel-action-anchors.js";

export type DuelPromptChoice =
  | {
    type: "selectOption";
    option: number;
    action: Extract<DuelAction, { type: "selectOption" }>;
    description?: number;
    descriptionList?: number[];
  }
  | {
    type: "selectYesNo";
    yes: boolean;
    action: Extract<DuelAction, { type: "selectYesNo" }>;
    description?: number;
  };

type SelectOptionAction = Extract<DuelAction, { type: "selectOption" }>;
type SelectYesNoAction = Extract<DuelAction, { type: "selectYesNo" }>;

export interface DuelPromptView {
  label: string;
  detail: string;
  prompt: DuelPromptState;
  choices: DuelPromptChoice[];
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
  if (prompt.origin === "luaOperation") parts.push("Lua operation");
  if (prompt.returnTo !== undefined) parts.push(`returns P${prompt.returnTo + 1}`);

  switch (prompt.type) {
    case "selectOption": {
      parts.push(`options ${prompt.options.join(", ")}`);
      if (prompt.descriptions?.length) parts.push(`text ${prompt.descriptions.join(", ")}`);
      if (prompt.descriptionLists?.length) parts.push(`lists ${formatDescriptionLists(prompt.descriptionLists)}`);
      break;
    }
    case "selectYesNo": {
      if (prompt.description !== undefined) parts.push(`text ${prompt.description}`);
      break;
    }
  }

  return parts.join(" · ");
}

function formatDescriptionLists(descriptionLists: readonly (readonly number[])[]): string {
  return descriptionLists.map((descriptions) => `[${descriptions.join(", ")}]`).join(", ");
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
    prompt: copyPrompt(prompt),
    choices: promptChoices(prompt, promptGroups),
    groups: promptGroups,
  };
}

function promptChoices(prompt: DuelPromptState, groups: readonly DuelActionUiGroup[]): DuelPromptChoice[] {
  const actions = groups.flatMap((group) => group.actions);
  if (prompt.type === "selectOption") {
    return prompt.options.flatMap((option, index) => {
      const action = actions.find((candidate): candidate is SelectOptionAction => (
        candidate.type === "selectOption" &&
        candidate.promptId === prompt.id &&
        candidate.player === prompt.player &&
        candidate.option === option
      ));
      if (!action) return [];
      return [{
        type: "selectOption",
        option,
        action: copySelectOptionAction(action),
        ...(prompt.descriptions?.[index] === undefined ? {} : { description: prompt.descriptions[index] }),
        ...(prompt.descriptionLists?.[index] === undefined ? {} : { descriptionList: [...prompt.descriptionLists[index]!] }),
      }];
    });
  }

  return [true, false].flatMap((yes) => {
    const action = actions.find((candidate): candidate is SelectYesNoAction => (
      candidate.type === "selectYesNo" &&
      candidate.promptId === prompt.id &&
      candidate.player === prompt.player &&
      candidate.yes === yes
    ));
    if (!action) return [];
    return [{
      type: "selectYesNo",
      yes,
      action: copySelectYesNoAction(action),
      ...(prompt.description === undefined ? {} : { description: prompt.description }),
    }];
  });
}

function copySelectOptionAction(action: SelectOptionAction): SelectOptionAction {
  return copyDuelAction(action) as SelectOptionAction;
}

function copySelectYesNoAction(action: SelectYesNoAction): SelectYesNoAction {
  return copyDuelAction(action) as SelectYesNoAction;
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") {
    return {
      ...prompt,
      options: [...prompt.options],
      ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }),
      ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }),
    };
  }
  return { ...prompt };
}
