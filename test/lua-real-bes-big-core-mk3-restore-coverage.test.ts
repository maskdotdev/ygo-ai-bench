import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real BES Big Core MK-3 restore coverage", () => {
  it("owns the procedure, counter, battle, and grave shuffle fixture", () => {
    const file = "test/lua-real-script-bes-big-core-mk3-counter-todeck.test.ts";
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
      'const bigCoreCode = "82821760"',
      "B.E.S. Big Core MK-3",
      "restores hand procedure, summon counters, battle counter removal, and grave SelfBanish shuffle",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCode(EFFECT_SPSUMMON_PROC)",
      "e1:SetTargetRange(POS_FACEUP_DEFENSE,0)",
      "Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==0",
      "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>0",
      "e2:SetCode(EVENT_SUMMON_SUCCESS)",
      "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)",
      "e:GetHandler():AddCounter(0x1f,3)",
      "e4:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e5:SetCode(EVENT_DAMAGE_STEP_END)",
      "c:IsCanRemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "Duel.Destroy(c,REASON_EFFECT)",
      "e6:SetCost(Cost.SelfBanish)",
      "return c:IsSetCard(SET_BES) and c:IsAbleToDeck()",
      "Duel.GetMatchingGroup(s.tdfilter,tp,LOCATION_GRAVE,0,nil)",
      "Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
      "eventName: \"specialSummoned\"",
      "eventName: \"counterAdded\"",
      "eventName: \"damageStepEnded\"",
      "eventName: \"counterRemoved\"",
      "eventName: \"banished\"",
      "eventName: \"sentToDeck\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
