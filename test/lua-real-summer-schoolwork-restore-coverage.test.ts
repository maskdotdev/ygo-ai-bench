import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Summer Schoolwork restore coverage", () => {
  it("owns the counter depletion recover and Schoolwork Trap set fixture", () => {
    const file = "test/lua-real-script-summer-schoolwork-counter-set.test.ts";
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
      'const summerCode = "77751766"',
      "Summer Schoolwork Successful!",
      "restores spell-effect Extra Deck summon trigger into last counter removal, recover, destroy, and Schoolwork Trap set",
      "c:EnableCounterPermit(COUNTER_SCHOOLWORK)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "c:AddCounter(COUNTER_SCHOOLWORK,5)",
      "e2:SetCategory(CATEGORY_DESTROY+CATEGORY_RECOVER+CATEGORY_LEAVE_GRAVE+CATEGORY_SET)",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "re and re:IsSpellTrapEffect() and eg:IsExists(Card.IsSummonLocation,1,nil,LOCATION_EXTRA)",
      "e3:SetCode(EVENT_TO_GRAVE)",
      "re and re:IsSpellTrapEffect() and eg:IsExists(Card.IsPreviousLocation,1,nil,LOCATION_DECK)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,4000)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_LEAVE_GRAVE,nil,1,tp,LOCATION_GRAVE)",
      "c:RemoveCounter(tp,COUNTER_SCHOOLWORK,1,REASON_EFFECT)",
      "Duel.Destroy(c,REASON_EFFECT)",
      "Duel.Recover(tp,4000,REASON_EFFECT)",
      "Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.setfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)",
      "Duel.SSet(tp,sc)",
      "Duel.Win(tp,WIN_REASON_SUMMER_SCHOOLWORK)",
      "eventName: \"counterRemoved\"",
      "eventName: \"recoveredLifePoints\"",
      "location: \"spellTrapZone\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
