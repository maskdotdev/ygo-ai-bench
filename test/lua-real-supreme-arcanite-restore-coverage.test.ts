import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Supreme Arcanite restore coverage", () => {
  it("owns the Spell Counter SelectEffect destroy and draw fixture", () => {
    const file = "test/lua-real-script-supreme-arcanite-counter-select.test.ts";
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
      'const supremeCode = "21113684"',
      "Supreme Arcanite Magician",
      "restores Spell Counter ATK scaling and RemoveCounterFromField cost into draw and destroy branches",
      "Fusion.AddProcMix(c,true,true,s.matfilter,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER))",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsFusionSummoned()",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),2,tp,COUNTER_SPELL)",
      "c:AddCounter(COUNTER_SPELL,2)",
      "e2:SetCode(EFFECT_UPDATE_ATTACK)",
      "return c:GetCounter(COUNTER_SPELL)*1000",
      "e3:SetCost(Cost.RemoveCounterFromField(COUNTER_SPELL,1))",
      "local op=Duel.SelectEffect(tp,",
      "Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)",
      "Duel.SetTargetPlayer(tp)",
      "Duel.SetTargetParam(1)",
      "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
      "Duel.Destroy(tc,REASON_EFFECT)",
      "Duel.Draw(p,d,REASON_EFFECT)",
      "eventName: \"counterRemoved\"",
      "eventName: \"destroyed\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
