import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Utopia Prime restore coverage", () => {
  it("owns detach plus LP cost destroy-to-banish count damage", () => {
    const file = "test/lua-real-script-utopia-prime-detach-pay-destroy-banish.test.ts";
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
      'const primeCode = "86532744"',
      "Number S39: Utopia Prime",
      "restores three-material detach and pay-to-10 LP cost into destroy-to-banish and count damage",
      "Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),4,3,s.ovfilter,aux.Stringid(id,0))",
      "e1:SetCategory(CATEGORY_DESTROY+CATEGORY_REMOVE+CATEGORY_DAMAGE)",
      "e1:SetType(EFFECT_TYPE_IGNITION)",
      "Duel.GetLP(1-tp)>=Duel.GetLP(tp)+3000",
      "e1:SetCost(Cost.AND(Cost.DetachFromSelf(3),Cost.PayLP(10,true)))",
      "return c:IsSpecialSummoned() and c:IsAbleToRemove()",
      "Duel.Destroy(g,REASON_EFFECT,LOCATION_REMOVED)>0",
      "Duel.GetOperatedGroup():FilterCount(s.rmctfilter,nil)",
      "Duel.BreakEffect()",
      "Duel.Damage(1-tp,ct*300,REASON_EFFECT)",
      'eventName: "lifePointCostPaid"',
      'eventName: "banished"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(7400)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
