import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Soul Energy MAX restore coverage", () => {
  it("owns Obelisk-gated release cost, opponent monster destruction, and damage", () => {
    const file = "test/lua-real-script-soul-energy-max-release-destroy-damage.test.ts";
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
      'const soulEnergyCode = "79339613"',
      "Soul Energy MAX!!!",
      "restores Obelisk-gated two-monster release cost into opponent field destruction and 4000 damage",
      "e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)",
      "e1:SetType(EFFECT_TYPE_ACTIVATE)",
      "return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD,0,1,nil)",
      "Duel.CheckReleaseGroupCost(tp,Card.IsFaceup,2,false,s.check,nil)",
      "Duel.SelectReleaseGroupCost(tp,Card.IsFaceup,2,2,false,s.check,nil)",
      "Duel.Release(g,REASON_COST)",
      "Duel.GetFieldGroup(tp,0,LOCATION_MZONE)",
      "Duel.Destroy(g,REASON_EFFECT)>0",
      "Duel.Damage(1-tp,4000,REASON_EFFECT)",
      'eventName: "released"',
      'eventName: "destroyed"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(4000)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
