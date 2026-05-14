import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { getPromptResponseActions } from "#duel/prompt-response.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { isLuaOptionPromptApi, isLuaYesNoPromptApi, luaOptionPromptApis, luaPromptApis, luaYesNoPromptApis } from "#lua/host-types.js";
import { applyYieldedLuaPromptToDuelState, duelPromptResponseToLuaValue, isYieldedLuaPromptCoroutineResult, luaPromptDecisionToDuelPrompt, resolveDuelPromptAndResumeLuaCoroutine, resumeLuaPromptCoroutineWithDuelResponse, yieldedLuaPromptToDuelPrompt } from "#lua/prompt-state.js";

type PromptResponse = Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>;

const optionPromptRoundTripCases = [
  {
    api: "SelectOption",
    code: "return Duel.SelectOption(0, 101, 102)",
    prompt: { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [101, 102], returned: 0 },
    selected: 1,
    values: [1],
  },
  {
    api: "SelectEffect",
    code: "return Duel.SelectEffect(0, {false, 201}, {true, 202}, {true, 203})",
    prompt: { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2, 3], descriptions: [202, 203], returned: 2 },
    selected: 3,
    values: [3],
  },
  {
    api: "AnnounceNumber",
    code: "return Duel.AnnounceNumber(0, 4, 7)",
    prompt: { id: "lua-prompt-1", api: "AnnounceNumber", player: 0, options: [4, 7], descriptions: [4, 7], returned: 4 },
    selected: 7,
    values: [7],
  },
  {
    api: "AnnounceNumberRange",
    code: "return Duel.AnnounceNumberRange(0, 2, 4, 2)",
    prompt: { id: "lua-prompt-1", api: "AnnounceNumberRange", player: 0, options: [3, 4], descriptions: [3, 4], returned: 3 },
    selected: 4,
    values: [4],
  },
  {
    api: "AnnounceCard",
    code: "return Duel.AnnounceCard(0, 123456)",
    prompt: { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [123456], descriptions: [123456], returned: 123456 },
    selected: 123456,
    values: [123456],
  },
  {
    api: "AnnounceType",
    code: "return Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)",
    prompt: { id: "lua-prompt-1", api: "AnnounceType", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 },
    selected: 2,
    values: [2],
  },
  {
    api: "AnnounceLevel",
    code: "return Duel.AnnounceLevel(0, 4, 6, 4)",
    prompt: { id: "lua-prompt-1", api: "AnnounceLevel", player: 0, options: [5, 6], descriptions: [5, 6], returned: 5 },
    selected: 6,
    values: [6],
  },
  {
    api: "AnnounceRace",
    code: "return Duel.AnnounceRace(0, 1, 6)",
    prompt: { id: "lua-prompt-1", api: "AnnounceRace", player: 0, options: [2, 4], descriptions: [2, 4], returned: 2 },
    selected: 4,
    values: [4],
  },
  {
    api: "AnnounceAttribute",
    code: "return Duel.AnnounceAttribute(0, 1, 36)",
    prompt: { id: "lua-prompt-1", api: "AnnounceAttribute", player: 0, options: [4, 32], descriptions: [4, 32], returned: 4 },
    selected: 32,
    values: [32],
  },
  {
    api: "SelectCardsFromCodes",
    code: "return Duel.SelectCardsFromCodes(0, 1, 1, false, false, 700, 800)",
    prompt: { id: "lua-prompt-1", api: "SelectCardsFromCodes", player: 0, options: [700, 800], descriptions: [700, 800], returned: 700 },
    selected: 800,
    values: [800],
  },
  {
    api: "SelectDisableField",
    code: "return Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)",
    prompt: { id: "lua-prompt-1", api: "SelectDisableField", player: 0, options: [1, 2, 4, 8, 16], descriptions: [1, 2, 4, 8, 16], returned: 1 },
    selected: 4,
    values: [4],
  },
  {
    api: "SelectField",
    code: "return Duel.SelectField(0, 1, LOCATION_MZONE, 0, 0)",
    prompt: { id: "lua-prompt-1", api: "SelectField", player: 0, options: [1, 2, 4, 8, 16], descriptions: [1, 2, 4, 8, 16], returned: 1 },
    selected: 8,
    values: [8],
  },
  {
    api: "SelectFieldZone",
    code: "return Duel.SelectFieldZone(0, 1, 0, LOCATION_MZONE, 0)",
    prompt: { id: "lua-prompt-1", api: "SelectFieldZone", player: 0, options: [65536, 131072, 262144, 524288, 1048576], descriptions: [65536, 131072, 262144, 524288, 1048576], returned: 65536 },
    selected: 262144,
    values: [262144],
  },
] satisfies Array<{ api: (typeof luaOptionPromptApis)[number]; code: string; prompt: unknown; selected: number; values: unknown[] }>;

const yesNoPromptRoundTripCases = [
  {
    api: "SelectYesNo",
    code: "return Duel.SelectYesNo(0, 301)",
    prompt: { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 301, returned: true },
  },
  {
    api: "SelectEffectYesNo",
    code: "return Duel.SelectEffectYesNo(0, nil, 401)",
    prompt: { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 401, returned: true },
  },
] satisfies Array<{ api: (typeof luaYesNoPromptApis)[number]; code: string; prompt: unknown }>;

describe("Lua prompt shim telemetry", () => {
  it("keeps canonical Lua prompt API lists aligned with prompt predicates", () => {
    expect(new Set(luaOptionPromptApis).size).toBe(luaOptionPromptApis.length);
    expect(new Set(luaYesNoPromptApis).size).toBe(luaYesNoPromptApis.length);
    expect(new Set(luaPromptApis).size).toBe(luaPromptApis.length);
    expect(luaPromptApis).toEqual([...luaOptionPromptApis, ...luaYesNoPromptApis]);
    expect(luaOptionPromptApis.filter((api) => luaYesNoPromptApis.includes(api as never))).toEqual([]);
    expect(luaOptionPromptApis.every((api) => isLuaOptionPromptApi(api) && !isLuaYesNoPromptApi(api))).toBe(true);
    expect(luaYesNoPromptApis.every((api) => isLuaYesNoPromptApi(api) && !isLuaOptionPromptApi(api))).toBe(true);
    expect(isLuaOptionPromptApi("SelectYesNo")).toBe(false);
    expect(isLuaYesNoPromptApi("SelectOption")).toBe(false);
    expect(isLuaOptionPromptApi("SelectCard")).toBe(false);
    expect(isLuaYesNoPromptApi("SelectCard")).toBe(false);
    expect(optionPromptRoundTripCases.map(({ api }) => api)).toEqual(luaOptionPromptApis);
    expect(yesNoPromptRoundTripCases.map(({ api }) => api)).toEqual(luaYesNoPromptApis);
  });

  it.each(optionPromptRoundTripCases)(
    "round-trips canonical option prompt API $api through browser legal actions",
    ({ api, code, prompt, selected, values }) => {
      expect(luaOptionPromptApis).toContain(api);
      const session = createDuel({ seed: 748, startingHandSize: 0, cardReader: createCardReader([]) });
      loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
      startDuel(session);

      const host = createLuaScriptHost(session);
      const yielded = host.runPromptCoroutine(code, `${api}-roundtrip.lua`);

      expect(isYieldedLuaPromptCoroutineResult(yielded)).toBe(true);
      if (!isYieldedLuaPromptCoroutineResult(yielded)) throw new Error(`Expected ${api} prompt yield`);
      expect(yielded.prompt).toEqual(prompt);
      const duelPrompt = yieldedLuaPromptToDuelPrompt(yielded);
      const actions = getPromptResponseActions(duelPrompt!, 0);
      const response = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === selected);
      expect(response).toBeTruthy();
      expect(resumeLuaPromptCoroutineWithDuelResponse(yielded, response!)).toEqual({ status: "completed", values });
    },
  );

  it.each(yesNoPromptRoundTripCases)("round-trips canonical yes/no prompt API $api through browser legal actions", ({ api, code, prompt }) => {
    expect(luaYesNoPromptApis).toContain(api);
    const session = createDuel({ seed: 749, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const yielded = host.runPromptCoroutine(code, `${api}-roundtrip.lua`);

    expect(isYieldedLuaPromptCoroutineResult(yielded)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(yielded)) throw new Error(`Expected ${api} prompt yield`);
    expect(yielded.prompt).toEqual(prompt);
    const duelPrompt = yieldedLuaPromptToDuelPrompt(yielded);
    const actions = getPromptResponseActions(duelPrompt!, 0);
    const response = actions.find((action): action is Extract<PromptResponse, { type: "selectYesNo" }> => action.type === "selectYesNo" && !action.yes);
    expect(response).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(yielded, response!)).toEqual({ status: "completed", values: [false] });
  });

  it("records synchronous SelectOption and SelectYesNo decisions while the coroutine prompt model is pending", () => {
    const session = createDuel({ seed: 724, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local regular = Duel.SelectOption(0, 101, 102)
      local sentinel = Duel.SelectOption(1, false, 201, 202)
      local yes = Duel.SelectYesNo(0, 301)
      local effect_yes = Duel.SelectEffectYesNo(0, nil, 401)
      local effect_choice = Duel.SelectEffect(1, {false, 501}, {true, 502}, {true, 503})
      local announced = Duel.AnnounceNumber(0, 7, 9)
      local ranged = Duel.AnnounceNumberRange(0, 2, 5, 2)
      local type_choice = Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local level = Duel.AnnounceLevel(0, 3, 5, 4)
      local race = Duel.AnnounceRace(0, 1, 6)
      local attribute = Duel.AnnounceAttribute(0, 1, 36)
      local disabled = Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local field = Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      local field_zone = Duel.SelectFieldZone(0, 1, 0, LOCATION_MZONE, 0)
      Debug.Message("prompt shim decisions " .. regular .. "/" .. sentinel .. "/" .. tostring(yes) .. "/" .. tostring(effect_yes) .. "/" .. effect_choice .. "/" .. announced .. "/" .. ranged .. "/" .. type_choice .. "/" .. level .. "/" .. race .. "/" .. attribute .. "/" .. disabled .. "/" .. field .. "/" .. field_zone)
      `,
      "prompt-shim-telemetry.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("prompt shim decisions 0/1/true/true/2/7/3/1/3/2/4/1/768/65536");
    expect(host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [101, 102], returned: 0 },
      { id: "lua-prompt-2", api: "SelectOption", player: 1, options: [1, 2], descriptions: [201, 202], returned: 1 },
      { id: "lua-prompt-3", api: "SelectYesNo", player: 0, description: 301, returned: true },
      { id: "lua-prompt-4", api: "SelectEffectYesNo", player: 0, description: 401, returned: true },
      { id: "lua-prompt-5", api: "SelectEffect", player: 1, options: [2, 3], descriptions: [502, 503], returned: 2 },
      { id: "lua-prompt-6", api: "AnnounceNumber", player: 0, options: [7, 9], descriptions: [7, 9], returned: 7 },
      { id: "lua-prompt-7", api: "AnnounceNumberRange", player: 0, options: [3, 4, 5], descriptions: [3, 4, 5], returned: 3 },
      { id: "lua-prompt-8", api: "AnnounceType", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 },
      { id: "lua-prompt-9", api: "AnnounceLevel", player: 0, options: [3, 5], descriptions: [3, 5], returned: 3 },
      { id: "lua-prompt-10", api: "AnnounceRace", player: 0, options: [2, 4], descriptions: [2, 4], returned: 2 },
      { id: "lua-prompt-11", api: "AnnounceAttribute", player: 0, options: [4, 32], descriptions: [4, 32], returned: 4 },
      { id: "lua-prompt-12", api: "SelectDisableField", player: 0, options: [1, 2, 4, 8, 16], descriptions: [1, 2, 4, 8, 16], returned: 1 },
      { id: "lua-prompt-13", api: "SelectField", player: 0, options: [768, 1280, 2304, 4352, 65792, 131328, 262400, 524544, 1048832, 1536, 2560, 4608, 66048, 131584, 262656, 524800, 1049088, 3072, 5120, 66560, 132096, 263168, 525312, 1049600, 6144, 67584, 133120, 264192, 526336, 1050624, 69632, 135168, 266240, 528384, 1052672, 196608, 327680, 589824, 1114112, 393216, 655360, 1179648, 786432, 1310720, 1572864], descriptions: [768, 1280, 2304, 4352, 65792, 131328, 262400, 524544, 1048832, 1536, 2560, 4608, 66048, 131584, 262656, 524800, 1049088, 3072, 5120, 66560, 132096, 263168, 525312, 1049600, 6144, 67584, 133120, 264192, 526336, 1050624, 69632, 135168, 266240, 528384, 1052672, 196608, 327680, 589824, 1114112, 393216, 655360, 1179648, 786432, 1310720, 1572864], returned: 768 },
      { id: "lua-prompt-14", api: "SelectFieldZone", player: 0, options: [65536, 131072, 262144, 524288, 1048576], descriptions: [65536, 131072, 262144, 524288, 1048576], returned: 65536 },
    ]);
    expect(session.state.prompt).toBeUndefined();
  });

  it("maps captured Lua prompt decisions into serializable duel prompts for browser response windows", () => {
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-1", api: "SelectOption", player: 1, options: [1, 2], descriptions: [201, 202], returned: 1 }, undefined, 0)).toEqual({
      id: "lua-prompt-1",
      type: "selectOption",
      player: 1,
      options: [1, 2],
      descriptions: [201, 202],
      returnTo: 0,
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 301, returned: true })).toEqual({
      id: "lua-prompt-2",
      type: "selectYesNo",
      player: 0,
      description: 301,
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-3", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [401, 402], returned: 1 })).toEqual({
      id: "lua-prompt-3",
      type: "selectOption",
      player: 0,
      options: [1, 2],
      descriptions: [401, 402],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-4", api: "SelectEffectYesNo", player: 1, description: 501, returned: true })).toEqual({
      id: "lua-prompt-4",
      type: "selectYesNo",
      player: 1,
      description: 501,
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-5", api: "AnnounceNumber", player: 0, options: [4, 7], descriptions: [4, 7], returned: 4 })).toEqual({
      id: "lua-prompt-5",
      type: "selectOption",
      player: 0,
      options: [4, 7],
      descriptions: [4, 7],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-6", api: "AnnounceNumberRange", player: 0, options: [2, 3], descriptions: [2, 3], returned: 2 })).toEqual({
      id: "lua-prompt-6",
      type: "selectOption",
      player: 0,
      options: [2, 3],
      descriptions: [2, 3],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-6b", api: "AnnounceCard", player: 0, options: [100, 200], descriptions: [100, 200], returned: 100 })).toEqual({
      id: "lua-prompt-6b",
      type: "selectOption",
      player: 0,
      options: [100, 200],
      descriptions: [100, 200],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-6c", api: "SelectCardsFromCodes", player: 1, options: [700, 800], descriptions: [700, 800], returned: 700 })).toEqual({
      id: "lua-prompt-6c",
      type: "selectOption",
      player: 1,
      options: [700, 800],
      descriptions: [700, 800],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-6d", api: "AnnounceType", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 })).toEqual({
      id: "lua-prompt-6d",
      type: "selectOption",
      player: 0,
      options: [1, 2],
      descriptions: [1, 2],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-7", api: "AnnounceLevel", player: 0, options: [4, 5], descriptions: [4, 5], returned: 4 })).toEqual({
      id: "lua-prompt-7",
      type: "selectOption",
      player: 0,
      options: [4, 5],
      descriptions: [4, 5],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-8", api: "AnnounceRace", player: 0, options: [2, 4], descriptions: [2, 4], returned: 2 })).toEqual({
      id: "lua-prompt-8",
      type: "selectOption",
      player: 0,
      options: [2, 4],
      descriptions: [2, 4],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-9", api: "AnnounceAttribute", player: 0, options: [4, 32], descriptions: [4, 32], returned: 4 })).toEqual({
      id: "lua-prompt-9",
      type: "selectOption",
      player: 0,
      options: [4, 32],
      descriptions: [4, 32],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "lua-prompt-10", api: "SelectFieldZone", player: 0, options: [65536, 131072], descriptions: [65536, 131072], returned: 65536 })).toEqual({
      id: "lua-prompt-10",
      type: "selectOption",
      player: 0,
      options: [65536, 131072],
      descriptions: [65536, 131072],
    });
    expect(luaPromptDecisionToDuelPrompt({ id: "missing-player", api: "SelectOption", options: [0], descriptions: [101], returned: 0 })).toBeUndefined();
  });

  it("maps browser prompt responses back to Lua resume values", () => {
    const optionPrompt = luaPromptDecisionToDuelPrompt({ id: "lua-prompt-1", api: "SelectOption", player: 1, options: [1, 2], descriptions: [201, 202], returned: 1 });
    const yesNoPrompt = luaPromptDecisionToDuelPrompt({ id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 301, returned: true });

    expect(optionPrompt).toBeTruthy();
    expect(yesNoPrompt).toBeTruthy();
    expect(duelPromptResponseToLuaValue(optionPrompt!, { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 2, label: "Select option 2" })).toBe(2);
    expect(duelPromptResponseToLuaValue(yesNoPrompt!, { type: "selectYesNo", player: 0, promptId: "lua-prompt-2", yes: false, label: "No" })).toBe(false);
    expect(() => duelPromptResponseToLuaValue(optionPrompt!, { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 0, label: "Select option 0" })).toThrow("Option 0 is not legal");
    expect(() => duelPromptResponseToLuaValue(optionPrompt!, { type: "selectYesNo", player: 1, promptId: "lua-prompt-1", yes: true, label: "Yes" })).toThrow("Prompt response does not match");
  });

  it("can suspend and resume Lua prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 725, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local option = Duel.SelectOption(0, 101, 102)
      local yes = Duel.SelectYesNo(0, 301)
      return option, yes
      `,
      "prompt-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected first prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [101, 102], returned: 0 });
    const optionPrompt = yieldedLuaPromptToDuelPrompt(first);
    expect(optionPrompt).toEqual({ id: "lua-prompt-1", type: "selectOption", player: 0, options: [0, 1], descriptions: [101, 102] });
    const optionActions = getPromptResponseActions(optionPrompt!, 0);
    expect(optionActions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 0, label: "Select option 0 (101)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 1, label: "Select option 1 (102)" },
    ]);
    const selectedOption = optionActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 1);
    expect(selectedOption).toBeTruthy();
    const second = resumeLuaPromptCoroutineWithDuelResponse(first, selectedOption!);
    expect(second.status).toBe("yielded");
    if (second.status !== "yielded") throw new Error("Expected second prompt yield");
    expect(second.prompt).toEqual({ id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 301, returned: true });
    const yesNoPrompt = yieldedLuaPromptToDuelPrompt(second);
    expect(yesNoPrompt).toEqual({ id: "lua-prompt-2", type: "selectYesNo", player: 0, description: 301 });
    const yesNoActions = getPromptResponseActions(yesNoPrompt!, 0);
    expect(yesNoActions).toEqual([
      { type: "selectYesNo", player: 0, promptId: "lua-prompt-2", yes: true, label: "Yes" },
      { type: "selectYesNo", player: 0, promptId: "lua-prompt-2", yes: false, label: "No" },
    ]);
    const selectedNo = yesNoActions.find((action): action is Extract<PromptResponse, { type: "selectYesNo" }> => action.type === "selectYesNo" && !action.yes);
    expect(selectedNo).toBeTruthy();
    const done = resumeLuaPromptCoroutineWithDuelResponse(second, selectedNo!);
    expect(done).toEqual({ status: "completed", values: [1, false] });
  });

  it("can suspend and resume SelectEffect prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 732, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local effect_choice = Duel.SelectEffect(0, {false, 401}, {true, 402}, {true, 403})
      local yes = Duel.SelectEffectYesNo(0, nil, 404)
      return effect_choice, yes
      `,
      "select-effect-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectEffect prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2, 3], descriptions: [402, 403], returned: 2 });
    const effectPrompt = yieldedLuaPromptToDuelPrompt(first);
    const effectActions = getPromptResponseActions(effectPrompt!, 0);
    expect(effectActions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (402)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 3, label: "Select option 3 (403)" },
    ]);
    const selectedEffect = effectActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 3);
    expect(selectedEffect).toBeTruthy();
    const second = resumeLuaPromptCoroutineWithDuelResponse(first, selectedEffect!);
    expect(second.status).toBe("yielded");
    if (second.status !== "yielded") throw new Error("Expected SelectEffectYesNo prompt yield");
    expect(second.prompt).toEqual({ id: "lua-prompt-2", api: "SelectEffectYesNo", player: 0, description: 404, returned: true });
    const yesNoPrompt = yieldedLuaPromptToDuelPrompt(second);
    const yesNoActions = getPromptResponseActions(yesNoPrompt!, 0);
    const selectedNo = yesNoActions.find((action): action is Extract<PromptResponse, { type: "selectYesNo" }> => action.type === "selectYesNo" && !action.yes);
    expect(selectedNo).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(second, selectedNo!)).toEqual({ status: "completed", values: [3, false] });
  });

  it("does not suspend SelectEffect calls with no enabled choices", () => {
    const session = createDuel({ seed: 733, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.runPromptCoroutine(
      `
      local effect_choice = Duel.SelectEffect(0, {false, 401}, {false, 402})
      return effect_choice
      `,
      "select-effect-empty-coroutine.lua",
    );

    expect(result).toEqual({ status: "completed", values: [undefined] });
    expect(host.promptDecisions).toEqual([]);
    expect(session.state.prompt).toBeUndefined();
  });

  it("can suspend and resume AnnounceNumber prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 734, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local announced = Duel.AnnounceNumber(0, 4, {7, 9})
      return announced
      `,
      "announce-number-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceNumber prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceNumber", player: 0, options: [4, 7, 9], descriptions: [4, 7, 9], returned: 4 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    expect(actions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 4, label: "Select option 4 (4)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 7, label: "Select option 7 (7)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 9, label: "Select option 9 (9)" },
    ]);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 7);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [7] });
  });

  it("does not suspend AnnounceNumber calls with no choices", () => {
    const session = createDuel({ seed: 735, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.runPromptCoroutine(
      `
      local announced = Duel.AnnounceNumber(0)
      return announced
      `,
      "announce-number-empty-coroutine.lua",
    );

    expect(result).toEqual({ status: "completed", values: [0] });
    expect(host.promptDecisions).toEqual([]);
    expect(session.state.prompt).toBeUndefined();
  });

  it("can suspend and resume AnnounceNumberRange prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 736, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local announced = Duel.AnnounceNumberRange(0, 2, 5, 3)
      return announced
      `,
      "announce-number-range-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceNumberRange prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceNumberRange", player: 0, options: [2, 4, 5], descriptions: [2, 4, 5], returned: 2 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    expect(actions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (2)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 4, label: "Select option 4 (4)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 5, label: "Select option 5 (5)" },
    ]);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 4);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [4] });
  });

  it("can suspend and resume AnnounceCard prompt calls through a coroutine", () => {
    const session = createDuel({
      seed: 742,
      startingHandSize: 0,
      cardReader: createCardReader([
        { code: "100", name: "Announce Normal", kind: "monster", typeFlags: 0x1 | 0x10 },
        { code: "200", name: "Announce Effect", kind: "monster", typeFlags: 0x1 | 0x20 },
      ]),
    });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local card = Duel.AnnounceCard(0, TYPE_MONSTER)
      return card
      `,
      "announce-card-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceCard prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [100, 200], descriptions: [100, 200], returned: 100 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 200);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [200] });
  });

  it("can suspend and resume AnnounceType prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 744, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local card_type = Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      return card_type
      `,
      "announce-type-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceType prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceType", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 2);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [2] });
  });

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
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 800);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [800] });
  });

  it("keeps multi-return SelectCardsFromCodes deterministic until multi-select browser prompts exist", () => {
    const session = createDuel({ seed: 746, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.runPromptCoroutine(
      `
      local first, second = Duel.SelectCardsFromCodes(1, 1, 2, false, false, 700, 800, 900)
      return first, second
      `,
      "select-cards-from-codes-multi-coroutine.lua",
    );

    expect(result).toEqual({ status: "completed", values: [700, 800] });
    expect(host.promptDecisions).toEqual([]);
    expect(session.state.prompt).toBeUndefined();
  });

  it("keeps index-table SelectCardsFromCodes deterministic until table-valued browser prompts exist", () => {
    const session = createDuel({ seed: 747, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.runPromptCoroutine(
      `
      local first, second = Duel.SelectCardsFromCodes(1, 1, 2, false, true, 700, 800, 900)
      return first[1], first[2], second[1], second[2]
      `,
      "select-cards-from-codes-index-table-coroutine.lua",
    );

    expect(result).toEqual({ status: "completed", values: [700, 1, 800, 2] });
    expect(host.promptDecisions).toEqual([]);
    expect(session.state.prompt).toBeUndefined();
  });

  it("keeps AnnounceNumberRange answerable when every range value is excluded", () => {
    const session = createDuel({ seed: 737, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local announced = Duel.AnnounceNumberRange(0, 2, 3, 2, 3)
      return announced
      `,
      "announce-number-range-all-excluded-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceNumberRange fallback prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceNumberRange", player: 0, options: [2], descriptions: [2], returned: 2 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    expect(actions).toEqual([{ type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (2)" }]);
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, actions[0] as Extract<PromptResponse, { type: "selectOption" }>)).toEqual({ status: "completed", values: [2] });
  });

  it("can suspend and resume AnnounceLevel prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 738, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local level = Duel.AnnounceLevel(0, 2, 5, 3)
      return level
      `,
      "announce-level-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceLevel prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceLevel", player: 0, options: [2, 4, 5], descriptions: [2, 4, 5], returned: 2 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    expect(actions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (2)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 4, label: "Select option 4 (4)" },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 5, label: "Select option 5 (5)" },
    ]);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 5);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [5] });
  });

  it("uses the full level range for default AnnounceLevel prompts", () => {
    const session = createDuel({ seed: 739, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local level = Duel.AnnounceLevel(0)
      return level
      `,
      "announce-level-default-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected default AnnounceLevel prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceLevel", player: 0, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], descriptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], returned: 1 });
  });

  it("can suspend and resume AnnounceRace and AnnounceAttribute prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 740, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local race = Duel.AnnounceRace(0, 1, 6)
      local attribute = Duel.AnnounceAttribute(0, 1, 36)
      return race, attribute
      `,
      "announce-mask-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected AnnounceRace prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "AnnounceRace", player: 0, options: [2, 4], descriptions: [2, 4], returned: 2 });
    const racePrompt = yieldedLuaPromptToDuelPrompt(first);
    const raceActions = getPromptResponseActions(racePrompt!, 0);
    const selectedRace = raceActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 4);
    expect(selectedRace).toBeTruthy();
    const second = resumeLuaPromptCoroutineWithDuelResponse(first, selectedRace!);
    expect(second.status).toBe("yielded");
    if (second.status !== "yielded") throw new Error("Expected AnnounceAttribute prompt yield");
    expect(second.prompt).toEqual({ id: "lua-prompt-2", api: "AnnounceAttribute", player: 0, options: [4, 32], descriptions: [4, 32], returned: 4 });
    const attributePrompt = yieldedLuaPromptToDuelPrompt(second);
    const attributeActions = getPromptResponseActions(attributePrompt!, 0);
    const selectedAttribute = attributeActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 32);
    expect(selectedAttribute).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(second, selectedAttribute!)).toEqual({ status: "completed", values: [4, 32] });
  });

  it("can suspend and resume field zone prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 741, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local disabled = Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local zone = Duel.SelectFieldZone(0, 1, 0, LOCATION_MZONE, 0)
      return disabled, zone
      `,
      "field-zone-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectDisableField prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectDisableField", player: 0, options: [1, 2, 4, 8, 16], descriptions: [1, 2, 4, 8, 16], returned: 1 });
    const disabledPrompt = yieldedLuaPromptToDuelPrompt(first);
    const disabledActions = getPromptResponseActions(disabledPrompt!, 0);
    const selectedDisabled = disabledActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 4);
    expect(selectedDisabled).toBeTruthy();
    const second = resumeLuaPromptCoroutineWithDuelResponse(first, selectedDisabled!);
    expect(second.status).toBe("yielded");
    if (second.status !== "yielded") throw new Error("Expected SelectFieldZone prompt yield");
    expect(second.prompt).toEqual({ id: "lua-prompt-2", api: "SelectFieldZone", player: 0, options: [65536, 131072, 262144, 524288, 1048576], descriptions: [65536, 131072, 262144, 524288, 1048576], returned: 65536 });
    const zonePrompt = yieldedLuaPromptToDuelPrompt(second);
    const zoneActions = getPromptResponseActions(zonePrompt!, 0);
    const selectedZone = zoneActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 262144);
    expect(selectedZone).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(second, selectedZone!)).toEqual({ status: "completed", values: [4, 262144] });
  });

  it("can suspend and resume SelectField prompt calls through a coroutine", () => {
    const session = createDuel({ seed: 745, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const first = host.runPromptCoroutine(
      `
      local field = Duel.SelectField(0, 1, LOCATION_MZONE, 0, 0)
      return field
      `,
      "select-field-coroutine.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectField prompt yield");
    expect(first.prompt).toEqual({ id: "lua-prompt-1", api: "SelectField", player: 0, options: [1, 2, 4, 8, 16], descriptions: [1, 2, 4, 8, 16], returned: 1 });
    const prompt = yieldedLuaPromptToDuelPrompt(first);
    const actions = getPromptResponseActions(prompt!, 0);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 8);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, selected!)).toEqual({ status: "completed", values: [8] });
  });

  it("can suspend and resume an already-registered Lua callback through a coroutine", () => {
    const session = createDuel({ seed: 728, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      function prompt_callback(tp, left, right)
        local selected = Duel.SelectOption(tp, left, right)
        return selected, left + right
      end
      `,
      "prompt-callback.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const yielded = host.runPromptCallback("prompt_callback", [1, 401, 402]);
    expect(isYieldedLuaPromptCoroutineResult(yielded)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(yielded)) throw new Error("Expected callback prompt yield");
    expect(yielded.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 1, options: [0, 1], descriptions: [401, 402], returned: 0 });
    const prompt = yieldedLuaPromptToDuelPrompt(yielded);
    const actions = getPromptResponseActions(prompt!, 1);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 1);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(yielded, selected!)).toEqual({ status: "completed", values: [1, 803] });
  });

  it("can suspend and resume a registered Lua effect operation through a coroutine", () => {
    const cards = [{ code: "728", name: "Prompt Operation Source", kind: "monster" as const }];
    const session = createDuel({ seed: 729, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["728"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c728={}
      function c728.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local selected = Duel.SelectOption(tp, 501, 502)
          Debug.Message("prompt operation selected " .. selected)
        end)
        c:RegisterEffect(e)
      end
      `,
      "prompt-operation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "728");
    const effect = session.state.effects.find((candidate) => candidate.sourceUid === source?.uid);
    expect(source).toBeTruthy();
    expect(effect).toBeTruthy();

    const yielded = host.runPromptEffectOperation(effect!.id, source!.uid, 0);
    expect(isYieldedLuaPromptCoroutineResult(yielded)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(yielded)) throw new Error("Expected operation prompt yield");
    expect(yielded.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [501, 502], returned: 0 });
    const prompt = yieldedLuaPromptToDuelPrompt(yielded);
    const actions = getPromptResponseActions(prompt!, 0);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 1);
    expect(selected).toBeTruthy();
    expect(resumeLuaPromptCoroutineWithDuelResponse(yielded, selected!)).toEqual({ status: "completed", values: [] });
    expect(host.messages).toContain("prompt operation selected 1");
    expect(session.state.log.some((entry) => entry.detail === "Lua effect operation resolved")).toBe(true);
  });

  it("can expose a yielded Lua prompt through duel legal actions", () => {
    const session = createDuel({ seed: 726, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const yielded = host.runPromptCoroutine(
      `
      local option = Duel.SelectOption(1, false, 201, 202)
      local yes = Duel.SelectYesNo(1, 301)
      return option, yes
      `,
      "prompt-state-coroutine.lua",
    );

    expect(yielded.status).toBe("yielded");
    if (yielded.status !== "yielded") throw new Error("Expected prompt yield");
    expect(applyYieldedLuaPromptToDuelState(session.state, yielded, 0)).toEqual({
      id: "lua-prompt-1",
      type: "selectOption",
      player: 1,
      options: [1, 2],
      descriptions: [201, 202],
      returnTo: 0,
    });
    expect(session.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    const actions = getDuelLegalActions(session, 1);
    expect(actions).toEqual([
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 1, label: "Select option 1 (201)", windowId: 0, windowKind: "prompt", windowToken: session.state.actionWindowToken },
      { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 2, label: "Select option 2 (202)", windowId: 0, windowKind: "prompt", windowToken: session.state.actionWindowToken },
    ]);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 2);
    expect(selected).toBeTruthy();
    const second = resolveDuelPromptAndResumeLuaCoroutine(session.state, yielded, selected!, 0);
    expect(second.status).toBe("yielded");
    if (second.status !== "yielded") throw new Error("Expected second prompt yield");
    expect(session.state.prompt).toEqual({ id: "lua-prompt-2", type: "selectYesNo", player: 1, description: 301, returnTo: 0 });
    expect(session.state.waitingFor).toBe(1);
    const yesNoActions = getDuelLegalActions(session, 1);
    expect(yesNoActions).toEqual([
      { type: "selectYesNo", player: 1, promptId: "lua-prompt-2", yes: true, label: "Yes", windowId: 0, windowKind: "prompt", windowToken: session.state.actionWindowToken },
      { type: "selectYesNo", player: 1, promptId: "lua-prompt-2", yes: false, label: "No", windowId: 0, windowKind: "prompt", windowToken: session.state.actionWindowToken },
    ]);
    const selectedNo = yesNoActions.find((action): action is Extract<PromptResponse, { type: "selectYesNo" }> => action.type === "selectYesNo" && !action.yes);
    expect(selectedNo).toBeTruthy();
    expect(resolveDuelPromptAndResumeLuaCoroutine(session.state, second, selectedNo!)).toEqual({ status: "completed", values: [2, false] });
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(0);
    expect(session.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toBe(true);
    expect(session.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(true);
  });

  it("can pause chain resolution on a Lua effect operation prompt and resume from a legal action", () => {
    const cards = [{ code: "729", name: "Chain Prompt Operation Source", kind: "monster" as const }];
    const session = createDuel({ seed: 730, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["729"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c729={}
      function c729.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local first = Duel.SelectOption(tp, 601, 602)
          Debug.Message("chain operation first " .. first)
          local yes = Duel.SelectYesNo(tp, 603)
          Debug.Message("chain operation yes " .. tostring(yes))
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-prompt-operation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "729");
    expect(source).toBeTruthy();
    const activation = getDuelLegalActions(session, 0).find((action): action is Extract<DuelResponse, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === source!.uid);
    expect(activation).toBeTruthy();

    const prompted = applyResponse(session, activation!);
    expect(prompted.ok, prompted.error).toBe(true);
    expect(session.state.prompt).toEqual({ id: "lua-prompt-1", type: "selectOption", player: 0, options: [0, 1], descriptions: [601, 602], returnTo: 0, origin: "luaOperation" });
    expect(prompted.state.luaOperationPrompt?.chainLink.effectId).toBe(activation!.effectId);
    expect(prompted.state.luaOperationPrompt?.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [601, 602], returned: 0 });
    expect(serializeDuel(session).state.luaOperationPrompt?.chainLink.effectId).toBe(activation!.effectId);
    expect(serializeDuel(session).state.luaOperationPrompt?.chainLink.sourceUid).toBe(source!.uid);
    expect(serializeDuel(session).state.luaOperationPrompt?.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [601, 602], returned: 0 });
    expect(prompted.legalActions).toEqual([
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 0, label: "Select option 0 (601)", windowId: session.state.actionWindowId, windowKind: "prompt", windowToken: session.state.actionWindowToken },
      { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 1, label: "Select option 1 (602)", windowId: session.state.actionWindowId, windowKind: "prompt", windowToken: session.state.actionWindowToken },
    ]);

    const selected = prompted.legalActions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 1);
    expect(selected).toBeTruthy();
    const secondPrompt = applyResponse(session, selected!);
    expect(secondPrompt.ok, secondPrompt.error).toBe(true);
    expect(host.messages).toContain("chain operation first 1");
    expect(session.state.prompt).toEqual({ id: "lua-prompt-2", type: "selectYesNo", player: 0, description: 603, returnTo: 0, origin: "luaOperation" });

    const selectedNo = secondPrompt.legalActions.find((action): action is Extract<PromptResponse, { type: "selectYesNo" }> => action.type === "selectYesNo" && !action.yes);
    expect(selectedNo).toBeTruthy();
    const resolved = applyResponse(session, selectedNo!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(host.messages).toContain("chain operation yes false");
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.chain).toEqual([]);
    expect(session.state.luaOperationPrompt).toBeUndefined();
    expect(session.state.status).toBe("awaiting");
    expect(session.state.log.some((entry) => entry.detail === "Lua effect operation resolved")).toBe(true);
  });

  it("fails closed when a restored Lua operation prompt no longer has its live continuation", () => {
    const cards = [{ code: "730", name: "Restored Chain Prompt Operation Source", kind: "monster" as const }];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 731, startingHandSize: 1, cardReader: reader });
    loadDecks(session, { 0: { main: ["730"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c730={}
      function c730.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Duel.SelectOption(tp, 701, 702)
          Debug.Message("restored continuation should not run")
        end)
        c:RegisterEffect(e)
      end
      `,
      "restored-chain-prompt-operation.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "730");
    const activation = getDuelLegalActions(session, 0).find((action): action is Extract<DuelResponse, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === source?.uid);
    expect(activation).toBeTruthy();
    expect(applyResponse(session, activation!).ok).toBe(true);
    expect(session.state.prompt?.origin).toBe("luaOperation");
    const serialized = serializeDuel(session);
    expect(serialized.state.luaOperationPrompt?.chainLink.effectId).toBe(activation!.effectId);
    expect(serialized.state.luaOperationPrompt?.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [701, 702], returned: 0 });

    const restored = restoreDuel(serialized, reader);
    expect(restored.state.luaOperationPrompt?.chainLink.effectId).toBe(activation!.effectId);
    expect(restored.state.luaOperationPrompt?.prompt).toEqual({ id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [701, 702], returned: 0 });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    const result = applyResponse(restored, { type: "selectOption", player: 0, promptId: "lua-prompt-1", option: 1, label: "Select option 1" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Response is not currently legal");
    expect(restored.state.prompt?.origin).toBe("luaOperation");
    expect(host.messages).not.toContain("restored continuation should not run");
  });

  it("rejects stale duel prompt state before resuming a Lua coroutine", () => {
    const session = createDuel({ seed: 727, startingHandSize: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const yielded = host.runPromptCoroutine(
      `
      local option = Duel.SelectOption(0, 101, 102)
      return option
      `,
      "stale-prompt-coroutine.lua",
    );

    expect(yielded.status).toBe("yielded");
    if (yielded.status !== "yielded") throw new Error("Expected prompt yield");
    const prompt = applyYieldedLuaPromptToDuelState(session.state, yielded, 0);
    if (prompt.type !== "selectOption") throw new Error("Expected select-option prompt");
    const actions = getDuelLegalActions(session, 0);
    const selected = actions.find((action): action is Extract<PromptResponse, { type: "selectOption" }> => action.type === "selectOption" && action.option === 1);
    expect(selected).toBeTruthy();

    delete session.state.prompt;
    expect(() => resolveDuelPromptAndResumeLuaCoroutine(session.state, yielded, selected!)).toThrow("Cannot resume Lua prompt coroutine without a pending duel prompt");
    session.state.prompt = { ...prompt, id: "other-prompt", options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }) };
    expect(() => resolveDuelPromptAndResumeLuaCoroutine(session.state, yielded, { ...selected!, promptId: "other-prompt" })).toThrow("Pending duel prompt does not match the yielded Lua prompt");
    session.state.prompt = { ...prompt, options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }) };
    expect(resolveDuelPromptAndResumeLuaCoroutine(session.state, yielded, selected!)).toEqual({ status: "completed", values: [1] });
  });
});
