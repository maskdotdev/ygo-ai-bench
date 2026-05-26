import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Mythical Beast Jackal restore coverage", () => {
  it("owns the counter-release summon fixture and PZONE destroy-counter script shape", () => {
    const file = "test/lua-real-script-mythical-beast-jackal-counter-summon.test.ts";
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
      'const jackalCode = "91182675"',
      "Mythical Beast Jackal",
      "restores MZONE counter-release Special Summon and PZONE destroy-counter script shape",
      "Pendulum.AddProcedure(c)",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "Duel.GetFieldGroupCount(tp,LOCATION_PZONE,0)==1",
      "Duel.SelectTarget(tp,s.ctfilter,tp,LOCATION_ONFIELD,0,1,1,c)",
      "Duel.Destroy(c,REASON_EFFECT)",
      "tc:AddCounter(COUNTER_SPELL,1)",
      "e2:SetOperation(aux.chainreg)",
      "e3:SetCode(EVENT_CHAIN_SOLVING)",
      "Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)",
      "Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)",
      "Duel.Release(c,REASON_COST)",
      "Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      "eventName: \"counterRemoved\"",
      "eventName: \"released\"",
      "eventName: \"specialSummoned\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
