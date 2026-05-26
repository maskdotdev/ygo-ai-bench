import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.S. Blaster Cannon Core restore coverage", () => {
  it("owns the opponent-count summon, summon counters, and damage-step-end remove-or-destroy fixture shape", () => {
    const file = "test/lua-real-script-bes-blaster-cannon-core-counter-battle.test.ts";
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
      'const blasterCode = "84257883"',
      "B.E.S. Blaster Cannon Core",
      "restores opponent-count hand summon, summon counters, and damage-step-end remove-or-destroy",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCode(EFFECT_SPSUMMON_PROC)",
      "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
      "Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0",
      "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0,nil)<Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE,nil)",
      "e2:SetCode(EVENT_SUMMON_SUCCESS)",
      "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)",
      "e:GetHandler():AddCounter(0x1f,3)",
      "e4:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e5:SetCode(EVENT_DAMAGE_STEP_END)",
      "c:IsCanRemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "Duel.Destroy(c,REASON_EFFECT)",
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
      'eventName: "damageStepEnded"',
      'eventName: "counterRemoved"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
