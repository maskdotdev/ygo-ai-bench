import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Magical Plant Mandragola restore coverage", () => {
  it("owns flip GetMatchingGroup Spell Counter placement across face-up eligible cards", () => {
    const file = "test/lua-real-script-magical-plant-mandragola-flip-group-counter.test.ts";
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
      'const mandragolaCode = "7802006"',
      "Magical Plant Mandragola",
      "restores FLIP GetMatchingGroup aux.Next Spell Counter placement across face-up eligible cards",
      "s.counter_list={COUNTER_SPELL}",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)",
      "return c:IsFaceup() and c:IsCanAddCounter(COUNTER_SPELL,1)",
      "Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)",
      "for tc in aux.Next(g) do",
      "tc:AddCounter(COUNTER_SPELL,1)",
      'eventName: "flipSummoned"',
      'eventName: "counterAdded"',
      "getDuelCardCounter(findCard(restoredTrigger.session, target.uid), counterSpell)).toBe(1)",
      "getDuelCardCounter(findCard(restoredTrigger.session, mandragola.uid), counterSpell)).toBe(0)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
