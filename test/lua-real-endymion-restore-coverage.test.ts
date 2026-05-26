import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Endymion restore coverage", () => {
  it("owns the Spell Counter PZONE summon and destroy-selection fixture", () => {
    const file = "test/lua-real-script-endymion-counter-pzone-summon.test.ts";
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
      'const endymionCode = "3611830"',
      "Endymion, the Mighty Master of Magic",
      "restores Spell Counter field cost into PZONE Special Summon and destroy selection",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "Pendulum.AddProcedure(c)",
      "e1:SetRange(LOCATION_PZONE)",
      "Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,6,REASON_COST)",
      "Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,6,REASON_COST)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
      "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsCanAddCounter,COUNTER_SPELL,1,false,LOCATION_ONFIELD),tp,LOCATION_ONFIELD,0,nil)",
      "Duel.BreakEffect()",
      "Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,dc,nil)",
      "Duel.Destroy(g,REASON_EFFECT)",
      "c:AddCounter(COUNTER_SPELL,oc)",
      "Duel.IsChainNegatable(ev)",
      "Duel.NegateActivation(ev)",
      "e3:SetValue(aux.tgoval)",
      "aux.DoubleSnareValidity(c,LOCATION_MZONE)",
      "eventName: \"counterRemoved\"",
      "eventName: \"specialSummoned\"",
      "eventName: \"breakEffect\"",
      "eventName: \"destroyed\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
