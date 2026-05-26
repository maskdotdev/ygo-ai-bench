import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Alien Stealthbuster restore coverage", () => {
  it("owns delayed sent-to-grave A-Counter placement and grave self-banish destruction", () => {
    const file = "test/lua-real-script-alien-stealthbuster-counter-destroy.test.ts";
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
      'const stealthbusterCode = "58066722"',
      "Alien Stealthbuster",
      "restores delayed sent-to-grave A-Counter placement and later grave self-banish destruction",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)",
      "e1:SetCode(EVENT_TO_GRAVE)",
      "Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)",
      "tc:AddCounter(COUNTER_A,2)",
      "e2:SetCategory(CATEGORY_DESTROY)",
      "e2:SetRange(LOCATION_GRAVE)",
      "e2:SetCondition(aux.exccon)",
      "e2:SetCost(Cost.SelfBanish)",
      "return c:IsFaceup() and c:GetCounter(COUNTER_A)>0",
      "Duel.IsExistingTarget(s.desfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)",
      "Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "sentToGraveyard"',
      'eventName: "counterAdded"',
      'eventName: "banished"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
