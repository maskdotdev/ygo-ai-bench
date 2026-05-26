import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Veda Kalarcanum restore coverage", () => {
  it("owns PZone Veda Counter scale updates into self Special Summon", () => {
    const file = "test/lua-real-script-veda-kalarcanum-pzone-counter-summon.test.ts";
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
      'const vedaCode = "40785230"',
      "Veda Kalarcanum",
      "restores Veda Counter scale updates into PZone self Special Summon cost",
      "c:EnableCounterPermit(COUNTER_VEDA,LOCATION_PZONE)",
      "c:SetSPSummonOnce(id)",
      "Pendulum.AddProcedure(c)",
      "e0:SetCode(EFFECT_SPSUMMON_CONDITION)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_DESTROYED)",
      "e:GetHandler():AddCounter(COUNTER_VEDA,3)",
      "e2:SetCode(EFFECT_UPDATE_LSCALE)",
      "e2b:SetCode(EFFECT_UPDATE_RSCALE)",
      "c:RemoveCounter(tp,COUNTER_VEDA,12,REASON_COST)",
      "Duel.SpecialSummon(c,0,tp,tp,true,true,POS_FACEUP)",
      "Duel.SkipPhase(turn_player,PHASE_BATTLE,RESET_PHASE|PHASE_END,1,1)",
      "e1:SetCode(EFFECT_CANNOT_BP)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE|LOCATION_REMOVED)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,4))",
      "currentLeftScale(restoredVeda, restored.session.state)).toBe(12)",
      "currentRightScale(restoredVeda, restored.session.state)).toBe(12)",
      "getDuelCardCounter(findCard(restored.session, veda.uid), counterVeda)).toBe(0)",
      'eventName: "counterRemoved"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
