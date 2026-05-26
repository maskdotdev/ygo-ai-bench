import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Ice Master restore coverage", () => {
  it("owns the WATER release summon, Ice Counter placement, and SelfTribute destroy fixture shape", () => {
    const file = "test/lua-real-script-ice-master-release-counter-destroy.test.ts";
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
      'const iceMasterCode = "32750510"',
      "Ice Master",
      "restores WATER release hand summon, Ice Counter targeting, and SelfTribute counter-monster destruction",
      "Duel.CheckReleaseGroup(c:GetControler(),Card.IsAttribute,2,false,2,true,c,c:GetControler(),nil,false,nil,ATTRIBUTE_WATER)",
      "Duel.SelectReleaseGroup(tp,Card.IsAttribute,2,2,false,true,true,c,nil,nil,false,nil,ATTRIBUTE_WATER)",
      "Duel.Release(g,REASON_COST)",
      "e2:SetCategory(CATEGORY_COUNTER)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "chkc:IsCanAddCounter(0x1015,1)",
      "Duel.IsExistingTarget(Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,0x1015,1)",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,0x1015,1)",
      "tc:AddCounter(0x1015,1)",
      "e3:SetCost(Cost.SelfTribute)",
      "return c:GetCounter(0x1015)~=0",
      "Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,e:GetHandler())",
      "Duel.Destroy(g,REASON_EFFECT)",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
