import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.F. Zelos restore coverage", () => {
  it("owns Boss Rush search, B.E.S. field effects, Special Summon, and counter trigger", () => {
    const file = "test/lua-real-script-bef-zelos-field-counter-summon.test.ts";
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
      'const zelosCode = "975299"',
      "B.E.F. Zelos",
      "restores Boss Rush search, B.E.S. stat/protection field effects, summon, and counter trigger",
      "Duel.SelectYesNo(tp,aux.Stringid(id,0))",
      "e2:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_BES))",
      "e4:SetValue(aux.indoval)",
      "e5:SetValue(aux.tgoval)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      "e7:SetCode(EVENT_SUMMON_SUCCESS)",
      "tc:AddCounter(0x1f,1)",
      "target:setcode:21",
      "cannot-be-effect-target:opponent",
      "getDuelCardCounter(findCard(restoredTrigger.session, handBes.uid), counterBes)).toBe(1)",
      'eventName: "sentToHandConfirmed"',
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
