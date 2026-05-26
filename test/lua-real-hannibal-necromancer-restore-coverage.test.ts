import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Hannibal Necromancer restore coverage", () => {
  it("owns the Spell Counter and face-up Trap destruction fixture shape", () => {
    const file = "test/lua-real-script-hannibal-necromancer-counter-trap-destroy.test.ts";
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
      'const hannibalCode = "5640330"',
      "Hannibal Necromancer",
      "restores summon Spell Counter placement and counter-cost face-up Trap destruction",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "c:SetCounterLimit(COUNTER_SPELL,1)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)",
      "e:GetHandler():AddCounter(COUNTER_SPELL,1)",
      "e:GetHandler():IsCanRemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)",
      "e:GetHandler():RemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)",
      "return c:IsTrap() and c:IsFaceup()",
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
