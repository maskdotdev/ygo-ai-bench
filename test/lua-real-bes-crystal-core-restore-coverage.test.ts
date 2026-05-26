import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real BES Crystal Core restore coverage", () => {
  it("owns the counter, battle protection, and position-change fixture", () => {
    const file = "test/lua-real-script-bes-crystal-core-counter-position.test.ts";
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
      'const crystalCode = "22790789"',
      "B.E.S. Crystal Core",
      "restores summon counters, battle indestructibility, and targeted position change",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)",
      "e:GetHandler():AddCounter(0x1f,3)",
      "e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e3:SetCode(EVENT_DAMAGE_STEP_END)",
      "c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "return e:GetHandler():GetCounter(0x1f)==0",
      "Duel.Destroy(c,REASON_EFFECT)",
      "e5:SetCategory(CATEGORY_POSITION)",
      "Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
      "Duel.ChangePosition(tc,POS_FACEUP_DEFENSE)",
      "eventName: \"counterAdded\"",
      "eventName: \"becameTarget\"",
      "eventName: \"positionChanged\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
