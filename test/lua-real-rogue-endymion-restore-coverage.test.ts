import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Rogue of Endymion restore coverage", () => {
  it("owns summon Spell Counter into discard-cost Continuous Spell set locks", () => {
    const file = "test/lua-real-script-rogue-endymion-counter-set-lock.test.ts";
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
      'const rogueCode = "44640691"',
      "Rogue of Endymion",
      "restores summon Spell Counter into discard-cost Continuous Spell set locks",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "c:AddCounter(COUNTER_SPELL,1)",
      "e3:SetCategory(CATEGORY_SET)",
      "c:RemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)",
      "Duel.DiscardHand(tp,s.cfilter,1,1,REASON_DISCARD+REASON_COST,nil)",
      "return c:IsSpell() and c:IsType(TYPE_CONTINUOUS) and c:IsSSetable()",
      "Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)",
      "Duel.SSet(tp,g)",
      "e1:SetCode(EFFECT_CANNOT_TRIGGER)",
      "e2:SetCode(EFFECT_CANNOT_ACTIVATE)",
      "e2:SetLabel(tc:GetCode())",
      "getDuelCardCounter(findCard(restoredIgnition.session, rogue.uid), counterSpell)).toBe(0)",
      "effectCannotTrigger",
      "effectCannotActivate",
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "discarded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
