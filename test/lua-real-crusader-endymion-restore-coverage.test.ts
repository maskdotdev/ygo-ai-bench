import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Crusader of Endymion restore coverage", () => {
  it("owns Gemini-status Spell Counter placement and self ATK gain", () => {
    const file = "test/lua-real-script-crusader-endymion-gemini-counter-stat.test.ts";
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
      'const crusaderCode = "73853830"',
      "Crusader of Endymion",
      "restores Gemini-status targeted Spell Counter placement into self ATK gain",
      "Gemini.AddProcedure(c)",
      "e1:SetCondition(Gemini.EffectStatusCondition)",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil,COUNTER_SPELL,1)",
      "tc:AddCounter(COUNTER_SPELL,1)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(600)",
      'eventName: "normalSummoned"',
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
      "currentAttack(findCard(finalRestore.session, crusader.uid), finalRestore.session.state)).toBe(2500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
