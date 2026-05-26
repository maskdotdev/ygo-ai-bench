import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Super BES Metal Slave restore coverage", () => {
  it("owns the SelectUnselectGroup send-cost summon and counter fixture", () => {
    const file = "test/lua-real-script-super-bes-metal-slave-counter-summon.test.ts";
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
      'const metalSlaveCode = "41516133"',
      "Super B.E.S. Metal Slave",
      "restores SelectUnselectGroup send cost into Special Summon and counter placement",
      "c:EnableCounterPermit(COUNTER_BES)",
      "aux.SelectUnselectGroup(g,e,tp,1,5,aux.dncheck,1,tp,HINTMSG_TOGRAVE)",
      "e:SetLabel(Duel.SendtoGrave(sg,REASON_COST))",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),tp,COUNTER_BES)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
      "Duel.BreakEffect()",
      "c:AddCounter(COUNTER_BES,count)",
      "e2:SetCost(Cost.RemoveCounterFromSelf(COUNTER_BES,1))",
      "Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCanBeEffectTarget,e),tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)",
      "aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_DESTROY)",
      "Duel.SetTargetCard(g)",
      "Duel.GetTargetCards(e)",
      "Duel.Destroy(tg,REASON_EFFECT)",
      "eventName: \"sentToGraveyard\"",
      "eventName: \"specialSummoned\"",
      "eventName: \"breakEffect\"",
      "eventName: \"counterAdded\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
