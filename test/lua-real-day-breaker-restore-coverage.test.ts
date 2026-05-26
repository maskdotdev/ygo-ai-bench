import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Day-Breaker restore coverage", () => {
  it("owns the Link Summon counter, Spell Counter ATK, and counter-cost destroy fixture shape", () => {
    const file = "test/lua-real-script-day-breaker-counter-destroy-stat.test.ts";
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
      'const dayBreakerCode = "91336701"',
      "Day-Breaker the Shining Magical Warrior",
      "restores Link Summon Spell Counter ATK scaling and two-counter target destroy",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER),2,2)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsLinkSummoned()",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)",
      "c:AddCounter(COUNTER_SPELL,1)",
      "e2:SetCode(EFFECT_UPDATE_ATTACK)",
      "return c:GetCounter(COUNTER_SPELL)*300",
      "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return c:IsFaceup() and c:IsRace(RACE_SPELLCASTER) and g:IsContains(c)",
      "local lg=e:GetHandler():GetLinkedGroup()",
      "e4:SetCategory(CATEGORY_DESTROY)",
      "e4:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "c:IsCanRemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)",
      "c:RemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)",
      "Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)",
      "Duel.GetFirstTarget()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "counterRemoved"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
