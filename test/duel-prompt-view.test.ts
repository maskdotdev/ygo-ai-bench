import { describe, expect, it } from "vitest";
import { duelPromptView, promptViewDetail, promptViewLabel, splitPromptGroups } from "../src/playtest-app/duel-prompt-view.js";
import type { DuelPromptState, LuaOperationPromptState } from "#duel/types.js";
import type { DuelActionUiGroup } from "../src/playtest-app/duel-action-anchors.js";

describe("duel prompt view", () => {
  it("labels option prompts with player, prompt id, options, and text ids", () => {
    const prompt: DuelPromptState = {
      id: "prompt-a",
      type: "selectOption",
      player: 0,
      returnTo: 1,
      options: [1, 3],
      descriptions: [101, 303],
    };

    expect(promptViewLabel(prompt)).toBe("Choose option");
    expect(promptViewDetail(prompt)).toBe("P1: choose one of 2 legal options.");
  });

  it("surfaces option prompt description lists", () => {
    const prompt: DuelPromptState = {
      id: "prompt-list",
      type: "selectOption",
      player: 0,
      options: [0, 1],
      descriptions: [10, 20],
      descriptionLists: [[101, 102], [201]],
    };

    expect(promptViewDetail(prompt)).toBe("P1: choose one of 2 legal options.");
  });

  it("labels yes/no prompts with description text id when present", () => {
    const prompt: DuelPromptState = {
      id: "prompt-b",
      type: "selectYesNo",
      player: 1,
      description: 42,
    };

    expect(promptViewLabel(prompt)).toBe("Confirm effect?");
    expect(promptViewDetail(prompt)).toBe("P2: choose Yes or No to continue resolving the current effect.");
  });

  it("marks Lua operation prompts in the visible detail", () => {
    const prompt: DuelPromptState = {
      id: "lua-prompt",
      type: "selectYesNo",
      player: 0,
      description: 77,
      returnTo: 1,
      origin: "luaOperation",
    };

    expect(promptViewDetail(prompt)).toBe("P1: choose Yes or No to continue resolving the current effect.");
  });

  it("splits the active prompt controls from other global groups", () => {
    const prompt: DuelPromptState = {
      id: "prompt-a",
      type: "selectOption",
      player: 0,
      options: [1],
    };
    const promptGroup: DuelActionUiGroup = {
      key: "prompt",
      label: "Option Prompt",
      promptId: "prompt-a",
      promptType: "selectOption",
      actions: [{ type: "selectOption", player: 0, promptId: "prompt-a", option: 1, label: "Choose 1" }],
    };
    const globalGroup: DuelActionUiGroup = {
      key: "pass",
      label: "Pass",
      actions: [{ type: "passChain", player: 0, label: "Pass" }],
    };

    expect(splitPromptGroups(prompt, [promptGroup, globalGroup])).toEqual({
      promptGroups: [promptGroup],
      globalGroups: [globalGroup],
    });
    expect(duelPromptView(prompt, [promptGroup, globalGroup])).toMatchObject({
      label: "Choose option",
      detail: "P1: choose one of 1 legal options.",
      prompt,
      choices: [{ type: "selectOption", option: 1, action: promptGroup.actions[0] }],
      groups: [promptGroup],
    });
  });

  it("surfaces structured option choices with copied prompt metadata for browser renderers", () => {
    const prompt: DuelPromptState = {
      id: "prompt-copy",
      type: "selectOption",
      player: 0,
      returnTo: 1,
      origin: "luaOperation",
      options: [1, 2],
      descriptions: [101, 202],
      descriptionLists: [[1001], [2002, 2003]],
    };
    const promptGroup: DuelActionUiGroup = {
      key: "prompt-copy",
      label: "Option Prompt",
      promptId: "prompt-copy",
      promptType: "selectOption",
      windowId: 44,
      windowKind: "prompt",
      windowToken: "prompt-copy-token",
      actions: [{ type: "selectOption", player: 0, promptId: "prompt-copy", option: 1, label: "Choose 1" }],
    };

    const view = duelPromptView(prompt, [promptGroup]);
    expect(view?.prompt).toEqual(prompt);
    expect(view?.groups).toEqual([
      expect.objectContaining({ windowId: 44, windowKind: "prompt", windowToken: "prompt-copy-token" }),
    ]);
    expect(view?.choices).toEqual([
      { type: "selectOption", option: 1, description: 101, descriptionList: [1001], action: promptGroup.actions[0] },
    ]);
    if (view?.prompt.type !== "selectOption") throw new Error("Expected selectOption prompt view");
    const [choice] = view.choices;
    if (choice?.type !== "selectOption") throw new Error("Expected selectOption prompt choice");

    view.prompt.options.push(3);
    view.prompt.descriptions?.push(303);
    view.prompt.descriptionLists?.[0]?.push(1002);
    choice.descriptionList?.push(1003);
    choice.action.option = 9;
    view.groups[0]!.label = "Mutated Prompt Group";
    view.groups[0]!.actions[0]!.label = "Mutated Choice";

    expect(prompt.options).toEqual([1, 2]);
    expect(prompt.descriptions).toEqual([101, 202]);
    expect(prompt.descriptionLists).toEqual([[1001], [2002, 2003]]);
    expect(promptGroup).toMatchObject({
      label: "Option Prompt",
      actions: [{ type: "selectOption", option: 1, label: "Choose 1" }],
    });
  });

  it("surfaces matching Lua operation prompt return metadata for browser renderers", () => {
    const prompt: DuelPromptState = {
      id: "lua-code-choice",
      type: "selectOption",
      player: 0,
      origin: "luaOperation",
      options: [1, 2],
      descriptions: [700, 800],
    };
    const luaOperationPrompt: LuaOperationPromptState = {
      chainLink: { id: "lua-chain", player: 0, sourceUid: "source-1", effectId: "effect-1" },
      prompt: {
        id: "lua-code-choice",
        api: "SelectCardsFromCodes",
        player: 0,
        options: [1, 2],
        descriptions: [700, 800],
        returned: 1,
        returnKind: "codeIndexTable",
        returnValues: [
          [{ code: 700, index: 1 }],
          [{ code: 800, index: 2 }],
        ],
      },
    };
    const promptGroup: DuelActionUiGroup = {
      key: "lua-code-choice",
      label: "Option Prompt",
      promptId: "lua-code-choice",
      promptType: "selectOption",
      actions: [
        { type: "selectOption", player: 0, promptId: "lua-code-choice", option: 1, label: "Choose 700" },
        { type: "selectOption", player: 0, promptId: "lua-code-choice", option: 2, label: "Choose 800" },
      ],
    };

    const view = duelPromptView(prompt, [promptGroup], luaOperationPrompt);

    expect(view?.detail).toBe("P1: choose a revealed card for this effect.");
    expect(view?.luaPrompt).toEqual(luaOperationPrompt.prompt);
    if (!view?.luaPrompt || !("returnValues" in view.luaPrompt) || view.luaPrompt.returnValues === undefined) throw new Error("Expected Lua prompt return values");
    const returned = view.luaPrompt.returnValues[0]![0]!;
    if (typeof returned !== "object" || returned === null || !("index" in returned)) throw new Error("Expected copied code/index return value");
    returned.index = 99;

    if (!("returnValues" in luaOperationPrompt.prompt)) throw new Error("Expected source Lua prompt return values");
    expect(luaOperationPrompt.prompt.returnValues?.[0]?.[0]).toEqual({ code: 700, index: 1 });
  });

  it("surfaces yes/no prompt choices with shared description metadata", () => {
    const prompt: DuelPromptState = {
      id: "yes-no-choice",
      type: "selectYesNo",
      player: 1,
      description: 900,
    };
    const promptGroup: DuelActionUiGroup = {
      key: "yes-no-choice",
      label: "Yes / No Prompt",
      promptId: "yes-no-choice",
      promptType: "selectYesNo",
      actions: [
        { type: "selectYesNo", player: 1, promptId: "yes-no-choice", yes: false, label: "No" },
        { type: "selectYesNo", player: 1, promptId: "yes-no-choice", yes: true, label: "Yes" },
      ],
    };

    expect(duelPromptView(prompt, [promptGroup])?.choices).toEqual([
      { type: "selectYesNo", yes: true, description: 900, action: promptGroup.actions[1] },
      { type: "selectYesNo", yes: false, description: 900, action: promptGroup.actions[0] },
    ]);
  });

  it("does not steal stale prompt groups for a different pending prompt", () => {
    const prompt: DuelPromptState = {
      id: "prompt-current",
      type: "selectYesNo",
      player: 0,
    };
    const staleGroup: DuelActionUiGroup = {
      key: "prompt-stale",
      label: "Option Prompt",
      promptId: "prompt-stale",
      promptType: "selectOption",
      actions: [{ type: "selectOption", player: 0, promptId: "prompt-stale", option: 1, label: "Choose 1" }],
    };

    expect(splitPromptGroups(prompt, [staleGroup])).toEqual({
      promptGroups: [],
      globalGroups: [staleGroup],
    });
    expect(duelPromptView(prompt, [staleGroup])).toBeUndefined();
  });
});
