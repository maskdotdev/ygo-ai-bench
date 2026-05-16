import { describe, expect, it } from "vitest";
import { duelPromptView, promptViewDetail, promptViewLabel, splitPromptGroups } from "../src/playtest-app/duel-prompt-view.js";
import type { DuelPromptState } from "#duel/types.js";
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

    expect(promptViewLabel(prompt)).toBe("Option Prompt");
    expect(promptViewDetail(prompt)).toBe("P1 · Prompt prompt-a · returns P2 · options 1, 3 · text 101, 303");
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

    expect(promptViewDetail(prompt)).toBe("P1 · Prompt prompt-list · options 0, 1 · text 10, 20 · lists [101, 102], [201]");
  });

  it("labels yes/no prompts with description text id when present", () => {
    const prompt: DuelPromptState = {
      id: "prompt-b",
      type: "selectYesNo",
      player: 1,
      description: 42,
    };

    expect(promptViewLabel(prompt)).toBe("Yes / No Prompt");
    expect(promptViewDetail(prompt)).toBe("P2 · Prompt prompt-b · text 42");
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

    expect(promptViewDetail(prompt)).toBe("P1 · Prompt lua-prompt · Lua operation · returns P2 · text 77");
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
    expect(duelPromptView(prompt, [promptGroup, globalGroup])).toEqual({
      label: "Option Prompt",
      detail: "P1 · Prompt prompt-a · options 1",
      groups: [promptGroup],
    });
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
