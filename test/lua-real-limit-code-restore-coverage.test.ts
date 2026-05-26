import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Limit Code restore coverage", () => {
  it("owns counter-based Code Talker summon, equip relation, End Phase script shape, and leave-field cleanup", () => {
    const file = "test/lua-real-script-limit-code-counter-equip-summon.test.ts";
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
      'const limitCode = "86607583"',
      "Limit Code",
      "restores established equip relation and leave-field Code Talker destruction",
      "c:EnableCounterPermit(0x47)",
      "e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER+CATEGORY_EQUIP)",
      "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH+EFFECT_COUNT_CODE_DUEL)",
      "e2:SetCode(EVENT_LEAVE_FIELD)",
      "e3:SetCode(EVENT_PHASE+PHASE_END)",
      "Duel.GetChainInfo(0,CHAININFO_CHAIN_ID)",
      "e2:SetCode(EVENT_CHAIN_DISABLED)",
      "Duel.GetLocationCountFromEx(tp,tp,nil,c)>0",
      "return c:IsRace(RACE_CYBERSE) and c:IsLinkMonster()",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,ct,0,0x47)",
      "Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)",
      "Duel.Equip(tp,c,tc)",
      "e1:SetCode(EFFECT_EQUIP_LIMIT)",
      "Duel.SpecialSummonComplete()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      "c:RemoveCounter(tp,0x47,1,REASON_EFFECT)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
