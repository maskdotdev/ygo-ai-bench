import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Dicephoon restore coverage", () => {
  it("owns its deterministic roll-3 Spell/Trap destruction branch", () => {
    const file = "test/lua-real-script-dicephoon-dice-destroy.test.ts";
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
      'const dicephoonCode = "3493058"',
      "Dicephoon",
      "restores deterministic roll-3 branch into selected Spell/Trap destruction",
      "e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_DICE)",
      "e1:SetType(EFFECT_TYPE_ACTIVATE)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)",
      "local dc=Duel.TossDice(tp,1)",
      "if dc==1 or dc==6 then",
      "Duel.Damage(tp,1000,REASON_EFFECT)",
      "elseif dc==5 then",
      "local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())",
      "local dg=g:Select(tp,2,2,nil)",
      "Duel.Destroy(dg,REASON_EFFECT)",
      "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler())",
      'eventName: "diceTossed"',
      'eventName: "destroyed"',
      "expect(restoredChain.session.state.lastDiceResults).toEqual([3])",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
