import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.S. Derringer Core restore coverage", () => {
  it("owns counter-cost SelectEffect search and Special Summon branches", () => {
    const file = "test/lua-real-script-bes-derringer-core-counter-select-effect.test.ts";
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
      'const derringerCode = "5121528"',
      "B.E.S. Derringer Core",
      "restores counter-cost quick effect into Boss Rush search branch",
      "restores counter-cost quick effect into graveyard B.E.S. Special Summon branch",
      "c:EnableCounterPermit(COUNTER_BES)",
      "Cost.Reveal(function(c) return c:IsSetCard(SET_BES) and c:IsMonster() end,true)",
      "Duel.BreakEffect()",
      "c:AddCounter(COUNTER_BES,3)",
      "Cost.RemoveCounterFromSelf(COUNTER_BES,1)",
      "local op=Duel.SelectEffect(tp,",
      "Duel.SendtoHand(g,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,g)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      'api: "SelectEffect"',
      "getDuelCardCounter(findCard(restored.session, derringer.uid), counterBes)).toBe(0)",
      'eventName: "counterRemoved"',
      'eventName: "sentToHandConfirmed"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
