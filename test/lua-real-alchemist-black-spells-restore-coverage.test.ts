import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Alchemist of Black Spells restore coverage", () => {
  it("owns targeted Spell Counter placement with self position change", () => {
    const file = "test/lua-real-script-alchemist-black-spells-counter-position.test.ts";
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
      'const alchemistCode = "78121572"',
      "Alchemist of Black Spells",
      "restores targeted Spell Counter placement after changing itself to defense",
      "s.counter_list={COUNTER_SPELL}",
      "return e:GetHandler():IsPosition(POS_FACEUP_ATTACK)",
      "return c:IsFaceup() and c:IsCanAddCounter(COUNTER_SPELL,1)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,0,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)",
      "Duel.ChangePosition(c,POS_FACEUP_DEFENSE)",
      "tc:AddCounter(COUNTER_SPELL,1)",
      'eventName: "becameTarget"',
      'eventName: "positionChanged"',
      'eventName: "counterAdded"',
      "getDuelCardCounter(findCard(restoredResolved.session, target.uid), counterSpell)).toBe(1)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
