import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Breaker Magical Warrior restore coverage", () => {
  it("owns the Spell Counter stat and RemoveCounterFromSelf destroy fixture shape", () => {
    const file = "test/lua-real-script-breaker-magical-warrior-counter-destroy.test.ts";
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
      'const breakerCode = "71413901"',
      "Breaker the Magical Warrior",
      "restores summon Spell Counter stat gain and RemoveCounterFromSelf Spell/Trap destruction",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "c:SetCounterLimit(COUNTER_SPELL,1)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),1,tp,COUNTER_SPELL)",
      "c:AddCounter(COUNTER_SPELL,1)",
      "return c:GetCounter(COUNTER_SPELL)*300",
      "e3:SetCost(Cost.RemoveCounterFromSelf(COUNTER_SPELL,1))",
      "Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)",
      "Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
