import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Infection Buzzking restore coverage", () => {
  it("owns Xyz detach cost, targeted destruction, break effect, and half-ATK damage", () => {
    const file = "test/lua-real-script-infection-buzzking-detach-destroy-damage.test.ts";
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
      'const buzzkingCode = "10666000"',
      "Number 1: Infection Buzzking",
      "restores Xyz material detach cost into target destruction and half-ATK damage",
      "Xyz.AddProcedure(c,nil,8,2,nil,nil,Xyz.InfiniteMats)",
      "e3:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)",
      "e3:SetType(EFFECT_TYPE_IGNITION)",
      "e3:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "e3:SetCost(Cost.DetachFromSelf(1,1,nil))",
      "Duel.SelectTarget(tp,nil,tp,0,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,tc:GetAttack()/2)",
      "Duel.Destroy(tc,REASON_EFFECT)>0",
      "Duel.BreakEffect()",
      "Duel.Damage(1-tp,dam,REASON_EFFECT)",
      'eventName: "detachedMaterial"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(6900)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
