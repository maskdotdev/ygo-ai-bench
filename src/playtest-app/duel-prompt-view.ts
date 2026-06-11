import { copyDuelAction } from "#duel/action-copy.js";
import type { DuelAction, DuelPromptState, LuaOperationPromptState } from "#duel/types.js";
import { copyLuaPromptResumeValue, copyLuaPromptResumeValues, isLuaOptionPromptDecision, type LuaPromptResumeValue } from "#lua/host-types.js";
import { copyDuelActionUiGroup, type DuelActionUiGroup } from "./duel-action-anchors.js";

export type DuelPromptChoice =
  | {
    type: "selectOption";
    option: number;
    action: Extract<DuelAction, { type: "selectOption" }>;
    description?: number;
    descriptionList?: number[];
    luaReturnValues?: LuaPromptResumeValue[];
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
  luaPrompt?: LuaOperationPromptState["prompt"];
  choices: DuelPromptChoice[];
  groups: DuelActionUiGroup[];
}

export interface SplitPromptGroups {
  promptGroups: DuelActionUiGroup[];
  globalGroups: DuelActionUiGroup[];
}

export function promptViewLabel(prompt: DuelPromptState, luaPrompt?: LuaOperationPromptState["prompt"]): string {
  switch (prompt.type) {
    case "selectOption":
      return optionPromptLabel(luaPrompt);
    case "selectYesNo":
      return yesNoPromptLabel(luaPrompt);
  }
  const exhaustive: never = prompt;
  return exhaustive;
}

export function promptViewDetail(prompt: DuelPromptState, luaPrompt?: LuaOperationPromptState["prompt"]): string {
  switch (prompt.type) {
    case "selectOption": {
      const count = prompt.options.length;
      return optionPromptDetail(luaPrompt, count, prompt.player);
    }
    case "selectYesNo": {
      return yesNoPromptDetail(luaPrompt, prompt.player);
    }
  }

  const exhaustive: never = prompt;
  return String(exhaustive);
}

function optionPromptLabel(luaPrompt: LuaOperationPromptState["prompt"] | undefined): string {
  if (!luaPrompt) return "Choose option";
  switch (luaPrompt.api) {
    case "SelectEffect":
      return "Choose effect";
    case "SelectOption":
      return "Choose option";
    case "SelectCard":
    case "SelectCardsFromCodes":
      return "Choose card";
    case "SortDecktop":
      return "Order Deck top";
    case "SortDeckbottom":
      return "Order Deck bottom";
    case "SelectDisableField":
    case "SelectField":
    case "SelectFieldZone":
      return "Choose zone";
    case "AnnounceCard":
      return "Declare card";
    case "AnnounceAttribute":
      return "Declare attribute";
    case "AnnounceRace":
      return "Declare type";
    case "AnnounceLevel":
      return "Declare level";
    case "AnnounceNumber":
    case "AnnounceNumberRange":
      return "Choose number";
    case "AnnounceType":
      return "Declare card type";
    case "SelectYesNo":
    case "SelectEffectYesNo":
      return "Choose option";
  }
}

function yesNoPromptLabel(luaPrompt: LuaOperationPromptState["prompt"] | undefined): string {
  if (luaPrompt?.api === "SelectEffectYesNo") return "Activate optional effect?";
  return "Confirm effect?";
}

function optionPromptDetail(luaPrompt: LuaOperationPromptState["prompt"] | undefined, count: number, player: number): string {
  const prefix = `P${player + 1}`;
  if (!luaPrompt) return `${prefix}: choose one of ${count} legal options.`;
  switch (luaPrompt.api) {
    case "SelectEffect":
      return `${prefix}: choose which available effect to apply.`;
    case "SelectCard":
    case "SelectCardsFromCodes":
      return `${prefix}: choose a revealed card for this effect.`;
    case "SortDecktop":
      return `${prefix}: choose the order for the top of the Deck.`;
    case "SortDeckbottom":
      return `${prefix}: choose the order for the bottom of the Deck.`;
    case "SelectDisableField":
    case "SelectField":
    case "SelectFieldZone":
      return `${prefix}: choose a legal zone for this effect.`;
    case "AnnounceCard":
      return `${prefix}: declare a card name for this effect.`;
    case "AnnounceAttribute":
      return `${prefix}: declare an Attribute for this effect.`;
    case "AnnounceRace":
      return `${prefix}: declare a Monster Type for this effect.`;
    case "AnnounceLevel":
      return `${prefix}: declare a Level for this effect.`;
    case "AnnounceNumber":
    case "AnnounceNumberRange":
      return `${prefix}: choose a number for this effect.`;
    case "AnnounceType":
      return `${prefix}: declare a card type for this effect.`;
    case "SelectOption":
      return `${prefix}: choose one of ${count} legal options.`;
    case "SelectYesNo":
    case "SelectEffectYesNo":
      return `${prefix}: choose an option for this effect.`;
  }
}

function yesNoPromptDetail(luaPrompt: LuaOperationPromptState["prompt"] | undefined, player: number): string {
  const prefix = `P${player + 1}`;
  if (luaPrompt?.api === "SelectEffectYesNo") return `${prefix}: choose whether to activate this optional effect.`;
  return `${prefix}: choose Yes or No to continue resolving the current effect.`;
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

export function duelPromptView(
  prompt: DuelPromptState | undefined,
  groups: readonly DuelActionUiGroup[],
  luaOperationPrompt?: LuaOperationPromptState,
): DuelPromptView | undefined {
  if (!prompt) return undefined;
  const { promptGroups } = splitPromptGroups(prompt, groups);
  if (!promptGroups.length) return undefined;
  const luaPrompt = matchingLuaPrompt(prompt, luaOperationPrompt);
  return {
    label: promptViewLabel(prompt, luaPrompt),
    detail: promptViewDetail(prompt, luaPrompt),
    prompt: copyPrompt(prompt),
    ...(luaPrompt === undefined ? {} : { luaPrompt: copyLuaPrompt(luaPrompt) }),
    choices: promptChoices(prompt, promptGroups, luaPrompt),
    groups: promptGroups.map(copyDuelActionUiGroup),
  };
}

function matchingLuaPrompt(prompt: DuelPromptState, luaOperationPrompt: LuaOperationPromptState | undefined): LuaOperationPromptState["prompt"] | undefined {
  if (prompt.origin !== "luaOperation") return undefined;
  if (luaOperationPrompt?.prompt.id !== prompt.id) return undefined;
  return luaOperationPrompt.prompt;
}

function promptChoices(prompt: DuelPromptState, groups: readonly DuelActionUiGroup[], luaPrompt?: LuaOperationPromptState["prompt"]): DuelPromptChoice[] {
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
        ...luaReturnValuesForChoice(luaPrompt, index),
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

function luaReturnValuesForChoice(luaPrompt: LuaOperationPromptState["prompt"] | undefined, index: number): { luaReturnValues?: LuaPromptResumeValue[] } {
  if (luaPrompt === undefined || !isLuaOptionPromptDecision(luaPrompt)) return {};
  const values = luaPrompt.returnValues?.[index];
  if (values !== undefined) return { luaReturnValues: copyLuaPromptResumeValues(values) };
  if (luaPrompt.returnKind !== "codeIndexTable") return {};
  const option = luaPrompt.options[index];
  const code = luaPrompt.descriptions[index];
  if (option === undefined || code === undefined) return {};
  return { luaReturnValues: [{ code, index: option }] };
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

function copyLuaPrompt(prompt: LuaOperationPromptState["prompt"]): LuaOperationPromptState["prompt"] {
  if (isLuaOptionPromptDecision(prompt)) {
    return {
      ...prompt,
      options: [...prompt.options],
      descriptions: [...prompt.descriptions],
      ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }),
      ...(prompt.returnValues === undefined ? {} : { returnValues: prompt.returnValues.map(copyLuaPromptResumeValues) }),
      ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }),
    };
  }
  return { ...prompt, ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }) };
}

function copyLuaPromptReturnValue(value: LuaPromptResumeValue): LuaPromptResumeValue {
  return copyLuaPromptResumeValue(value);
}
