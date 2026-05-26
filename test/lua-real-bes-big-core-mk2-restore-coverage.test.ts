import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.S. Big Core MK-2 restore coverage", () => {
  it("owns the no-tribute summon procedure, special summon counters, and damage-step-end remove-or-destroy fixture shape", () => {
    const file = "test/lua-real-script-bes-big-core-mk2-counter-battle.test.ts";
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
      'const mk2Code = "75937826"',
      "B.E.S. Big Core MK-2",
      "restores no-tribute summon procedure, special summon counters, and damage-step-end remove-or-destroy",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
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
      "e5:SetCode(EFFECT_SUMMON_PROC)",
      "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0)==0",
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
      'eventName: "damageStepEnded"',
      'eventName: "counterRemoved"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
