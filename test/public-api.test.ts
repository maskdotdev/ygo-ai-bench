import { describe, expect, it } from "vitest";
import { applyLuaRestoreResponse, applyYieldedLuaPromptToDuelState, duelPromptResponseToLuaValue, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, isLuaOptionPromptApi, isLuaYesNoPromptApi, isYieldedLuaPromptCoroutineResult, luaOptionPromptApis, luaPromptApis, luaPromptDecisionToDuelPrompt, luaYesNoPromptApis, resolveDuelPromptAndResumeLuaCoroutine, restoreDuelWithLuaScripts, resumeLuaPromptCoroutineWithDuelResponse, yieldedLuaPromptToDuelPrompt } from "../src/index.js";

describe("public API", () => {
  it("exports fail-closed Lua snapshot restore helpers", () => {
    expect(restoreDuelWithLuaScripts).toBeTypeOf("function");
    expect(getLuaRestoreLegalActions).toBeTypeOf("function");
    expect(getLuaRestoreLegalActionGroups).toBeTypeOf("function");
    expect(applyLuaRestoreResponse).toBeTypeOf("function");
  });

  it("exports Lua prompt bridge helpers", () => {
    expect(luaPromptDecisionToDuelPrompt).toBeTypeOf("function");
    expect(yieldedLuaPromptToDuelPrompt).toBeTypeOf("function");
    expect(applyYieldedLuaPromptToDuelState).toBeTypeOf("function");
    expect(duelPromptResponseToLuaValue).toBeTypeOf("function");
    expect(resumeLuaPromptCoroutineWithDuelResponse).toBeTypeOf("function");
    expect(resolveDuelPromptAndResumeLuaCoroutine).toBeTypeOf("function");
    expect(isYieldedLuaPromptCoroutineResult).toBeTypeOf("function");
  });

  it("exports Lua prompt API inventory helpers", () => {
    expect(luaOptionPromptApis).toEqual([
      "SelectOption",
      "SelectEffect",
      "AnnounceNumber",
      "AnnounceNumberRange",
      "AnnounceCard",
      "AnnounceType",
      "AnnounceLevel",
      "AnnounceRace",
      "AnnounceAttribute",
      "SelectCardsFromCodes",
      "SelectDisableField",
      "SelectField",
      "SelectFieldZone",
    ]);
    expect(luaYesNoPromptApis).toEqual(["SelectYesNo", "SelectEffectYesNo"]);
    expect(luaPromptApis).toEqual([...luaOptionPromptApis, ...luaYesNoPromptApis]);
    expect(isLuaOptionPromptApi("AnnounceType")).toBe(true);
    expect(isLuaYesNoPromptApi("SelectEffectYesNo")).toBe(true);
    expect(isLuaOptionPromptApi("SelectYesNo")).toBe(false);
    expect(isLuaYesNoPromptApi("SelectOption")).toBe(false);
  });
});
