import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Arcanite Assault restore coverage", () => {
  it("owns the counter, destroy, and revive fixture script shape", () => {
    const file = "test/lua-real-script-arcanite-assault-counter-destroy-revive.test.ts";
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
      'const assaultCode = "14553285"',
      "Arcanite Magician/Assault Mode",
      "restores Special Summon counters, counter-cost board wipe, and destroyed Arcanite revive",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "c:AddMustBeSpecialSummoned()",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),2,tp,COUNTER_SPELL)",
      "c:AddCounter(COUNTER_SPELL,2)",
      "e2:SetCode(EFFECT_UPDATE_ATTACK)",
      "c:GetCounter(COUNTER_SPELL)*1000",
      "e3:SetCost(Cost.RemoveCounterFromSelf(COUNTER_SPELL,2))",
      "Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)",
      "Duel.Destroy(g,REASON_EFFECT)",
      "e4:SetCode(EVENT_DESTROYED)",
      "Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
      "Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.GetFirstTarget()",
      "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
      "eventName: \"counterAdded\"",
      "eventName: \"counterRemoved\"",
      "eventName: \"destroyed\"",
      "eventName: \"becameTarget\"",
      "eventName: \"specialSummoned\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
