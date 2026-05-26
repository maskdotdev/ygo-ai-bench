import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Predaplanning restore coverage", () => {
  it("owns the counter, level-change, and grave fusion destroy fixture script shape", () => {
    const file = "test/lua-real-script-predaplanning-counter-fusion-destroy.test.ts";
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
      'const predaplanningCode = "44536921"',
      "Predaplanning",
      "restores Predaplanning deck cost, Predator Counters, level change, and grave DARK Fusion destroy trigger",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "Duel.SelectMatchingCard(tp,s.thcfilter,tp,LOCATION_DECK,0,1,1,nil)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,0,COUNTER_PREDATOR)",
      "tc:AddCounter(COUNTER_PREDATOR,1)",
      "e1:SetCode(EFFECT_CHANGE_LEVEL)",
      "return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0",
      "e2:SetCategory(CATEGORY_DESTROY)",
      "e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e2:SetCost(Cost.SelfBanish)",
      "return c:IsAttribute(ATTRIBUTE_DARK) and c:GetSummonPlayer()==tp and c:IsFusionSummoned()",
      "Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.GetFirstTarget()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "sentToGraveyard"',
      'eventName: "counterAdded"',
      'eventName: "specialSummoned"',
      'eventName: "banished"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
