import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Breaker Dark Magical Warrior restore coverage", () => {
  it("owns the labeled Spell Counter stat and counter-cost destroy fixture shape", () => {
    const file = "test/lua-real-script-breaker-dark-magical-warrior-counter-destroy.test.ts";
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
      'const breakerCode = "22923081"',
      "Breaker the Dark Magical Warrior",
      "restores labeled summon Spell Counters, stat gain, and counter-cost Spell/Trap destruction",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "e1:SetLabel(2)",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsPendulumSummoned()",
      "e2:SetLabel(3)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),0,COUNTER_SPELL)",
      "e:GetHandler():AddCounter(COUNTER_SPELL,e:GetLabel())",
      "return c:GetCounter(COUNTER_SPELL)*400",
      "e:GetHandler():IsCanRemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)",
      "e:GetHandler():RemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)",
      "Duel.IsExistingTarget(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
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
