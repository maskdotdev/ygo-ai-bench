import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Okiku Dish Count restore coverage", () => {
  it("owns the opponent chain Dish Counter fixture", () => {
    const file = "test/lua-real-script-okiku-dish-count-chain-counters.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text).toContain("restoreDuelWithLuaScripts");
    expect(text).toContain("restoreComplete");
    expect(text).toContain('incompleteReasons.join("; ")');
    expect(text).toContain("missingRegistryKeys).toEqual([])");
    expect(text).toContain("missingChainLimitRegistryKeys).toEqual([])");
    expect(text).toContain("getLuaRestoreLegalActions");
    expect(text).toContain("getLuaRestoreLegalActionGroups");
    expect(text).toContain("getGroupedDuelLegalActions");
    expect(text).toContain("flatMap((group) => group.actions)");

    const required = [
      'const okikuCode = "89086647"',
      "Okiku's Dish Count",
      "restores opponent EVENT_CHAINING response into Dish Counters and static protection thresholds",
      "c:EnableCounterPermit(COUNTER_DISH)",
      "e0:SetType(EFFECT_TYPE_ACTIVATE)",
      "e1:SetCode(EVENT_CHAINING)",
      "e1:SetCountLimit(1,0,EFFECT_COUNT_CODE_CHAIN)",
      "return rp==1-tp",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),Duel.GetCurrentChain(),tp,COUNTER_DISH)",
      "e:GetHandler():AddCounter(COUNTER_DISH,Duel.GetCurrentChain())",
      "e2a:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
      "e2a:SetValue(aux.tgoval)",
      "e2b:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
      "e2b:SetValue(aux.indoval)",
      "e2c:SetCode(EFFECT_SELF_TOGRAVE)",
      "e3:SetCode(EVENT_TO_GRAVE)",
      "Duel.IsPlayerCanDiscardDeck(tp,10)",
      "Duel.DiscardDeck(tp,10,REASON_EFFECT)",
      "windowKind: \"chainResponse\"",
      "eventName: \"counterAdded\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
