import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Predaplant Longinephila restore coverage", () => {
  it("owns grave SelfBanish SelectEffect Predator Counter Level lock and summon/search/set script shape", () => {
    const file = "test/lua-real-script-predaplant-longinephila-counter-level.test.ts";
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
      'const longinephilaCode = "44994712"',
      "Predaplant Longinephila",
      "restores grave SelfBanish SelectEffect into Predator Counter placement and Level 1 lock",
      "e1a:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)",
      "e1a:SetCode(EVENT_SUMMON_SUCCESS)",
      "e1b:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e2:SetCost(Cost.SelfBanish)",
      "local op=Duel.SelectEffect(tp,",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_PREDATOR)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_LEAVE_GRAVE,nil,1,tp,0)",
      "tc:AddCounter(COUNTER_PREDATOR,1)",
      "e1:SetCode(EFFECT_CHANGE_LEVEL)",
      "Duel.SSet(tp,sg)",
      "Duel.SendtoHand(g,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,g)",
      'api: "SelectEffect"',
      'eventName: "banished"',
      'eventName: "counterAdded"',
      "currentLevel(findCard(restored.session, target.uid), restored.session.state)).toBe(1)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
