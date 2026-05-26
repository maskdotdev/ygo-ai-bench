import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real A Cell Scatter Burst restore coverage", () => {
  it("owns the targeted Alien destruction and repeated A-Counter placement fixture shape", () => {
    const file = "test/lua-real-script-a-cell-scatter-burst-counter-destroy.test.ts";
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
      'const scatterBurstCode = "73262676"',
      "\"A\" Cell Scatter Burst",
      "restores own Alien target destruction into repeated opponent A-Counter placement",
      "e1:SetCategory(CATEGORY_COUNTER+CATEGORY_DESTROY)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return c:IsFaceup() and c:IsSetCard(SET_ALIEN) and c:HasLevel()",
      "Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil)",
      "Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)",
      "local tc=Duel.GetFirstTarget()",
      "local lv=tc:GetLevel()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)",
      "sg:GetFirst():AddCounter(COUNTER_A,1)",
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
      'eventName: "sentToGraveyard"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
