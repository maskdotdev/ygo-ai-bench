import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { getPromptResponseActions } from "#duel/prompt-response.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { isYieldedLuaPromptCoroutineResult, resumeLuaPromptCoroutineWithDuelResponse, yieldedLuaPromptToDuelPrompt } from "#lua/prompt-state.js";

type PromptResponse = Extract<DuelResponse, { type: "selectOption" }>;

describe("Lua SelectCardsFromCodes multi-return prompts", () => {
  it("can suspend and resume single SelectCardsFromCodes prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 743, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local code = Duel.SelectCardsFromCodes(1, 1, 1, false, false, 700, 800)
      return code
      `,
      "select-cards-from-codes-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectCardsFromCodes prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectCardsFromCodes", player: 1, options: [700, 800], descriptions: [700, 800], returned: 700 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 1);
    const selected = actions.find((action): action is PromptResponse => action.type === "selectOption" && action.option === 800);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [800] });
  });

  it("can suspend and resume single index-table SelectCardsFromCodes prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 742, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local selected = Duel.SelectCardsFromCodes(1, 1, 1, false, true, 700, 800)
      return selected[1], selected[2]
      `,
      "select-cards-from-codes-index-table-single-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectCardsFromCodes index-table prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectCardsFromCodes", player: 1, options: [1, 2], descriptions: [700, 800], returned: 1, returnKind: "codeIndexTable" });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 1);
    expect(actions).toEqual([
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 1, label: "Select option 1 (700)" },
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (800)" },
    ]);
    const selected = actions.find((action): action is PromptResponse => action.type === "selectOption" && action.option === 2);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [800, 2] });
  });

  it("can suspend and resume multi-return SelectCardsFromCodes prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 746, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local first, second = Duel.SelectCardsFromCodes(1, 1, 2, false, false, 700, 800, 900)
      return first, second
      `,
      "select-cards-from-codes-multi-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectCardsFromCodes multi-return prompt yield");
    expect(first.prompt).toEqual({
      id: "lua-prompt-1",
      api: "SelectCardsFromCodes",
      player: 1,
      options: [1, 2, 3],
      descriptions: [700, 700, 800],
      descriptionLists: [[700, 800], [700, 900], [800, 900]],
      returned: 1,
      returnValues: [[700, 800], [700, 900], [800, 900]],
    });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 1);
    expect(actions).toEqual([
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 1, label: "Select option 1 (700, 800)" },
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (700, 900)" },
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 3, label: "Select option 3 (800, 900)" },
    ]);
    const selected = actions.find((action): action is PromptResponse => action.type === "selectOption" && action.option === 3);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [800, 900] });
  });

  it("can suspend and resume multi-return index-table SelectCardsFromCodes prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 747, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local first, second = Duel.SelectCardsFromCodes(1, 1, 2, false, true, 700, 800, 900)
      return first[1], first[2], second[1], second[2]
      `,
      "select-cards-from-codes-index-table-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectCardsFromCodes multi-return index-table prompt yield");
    expect(first.prompt).toEqual({
      id: "lua-prompt-1",
      api: "SelectCardsFromCodes",
      player: 1,
      options: [1, 2, 3],
      descriptions: [700, 700, 800],
      descriptionLists: [[700, 800], [700, 900], [800, 900]],
      returned: 1,
      returnValues: [
        [{ code: 700, index: 1 }, { code: 800, index: 2 }],
        [{ code: 700, index: 1 }, { code: 900, index: 3 }],
        [{ code: 800, index: 2 }, { code: 900, index: 3 }],
      ],
    });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 1);
    const selected = actions.find((action): action is PromptResponse => action.type === "selectOption" && action.option === 2);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [700, 1, 900, 3] });
  });
});
