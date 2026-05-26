import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Snowman Creator restore coverage", () => {
  it("owns WATER-count Ice Counter placement and optional BreakEffect destruction", () => {
    const file = "test/lua-real-script-snowman-creator-counter-destroy.test.ts";
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
      'const snowmanCode = "15893860"',
      "Snowman Creator",
      "restores WATER-count Ice Counter placement into optional BreakEffect destruction",
      "e1:SetCategory(CATEGORY_COUNTER+CATEGORY_DESTROY)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WATER),tp,LOCATION_MZONE,0,1,nil)",
      "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WATER),tp,LOCATION_MZONE,0,nil)",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)",
      "tc:AddCounter(0x1015,1)",
      "if ct>=3 and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then",
      "Duel.BreakEffect()",
      "Duel.SelectMatchingCard(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)",
      "Duel.HintSelection(dg)",
      "Duel.Destroy(dg,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "breakEffect"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
