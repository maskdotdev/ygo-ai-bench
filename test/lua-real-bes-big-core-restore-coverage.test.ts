import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.S. Big Core restore coverage", () => {
  it("owns the summon counters and battle remove-or-destroy fixture shape", () => {
    const file = "test/lua-real-script-bes-big-core-counter-battle.test.ts";
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
      'const bigCoreCode = "14148099"',
      "B.E.S. Big Core",
      "restores tribute summon counters and damage-step-end counter removal or self-destruction",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)",
      "e:GetHandler():AddCounter(0x1f,3)",
      "e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e3:SetCode(EVENT_DAMAGE_STEP_END)",
      "return e:GetHandler():GetCounter(0x1f)~=0",
      "c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "e4:SetCode(EVENT_DAMAGE_STEP_END)",
      "return e:GetHandler():GetCounter(0x1f)==0",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)",
      "Duel.Destroy(c,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "damageStepEnded"',
      'eventName: "counterRemoved"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
