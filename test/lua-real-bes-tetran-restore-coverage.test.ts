import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real B.E.S. Tetran restore coverage", () => {
  it("owns the summon counters, battle counter removal, and counter-cost destroy fixture shape", () => {
    const file = "test/lua-real-script-bes-tetran-counter-battle-destroy.test.ts";
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
      'const tetranCode = "44954628"',
      "B.E.S. Tetran",
      "restores summon counters, battle counter removal, and counter-cost Spell/Trap destruction",
      "c:EnableCounterPermit(0x1f)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)",
      "e:GetHandler():AddCounter(0x1f,3)",
      "e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e3:SetCode(EVENT_DAMAGE_STEP_END)",
      "c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)",
      "e4:SetCode(EVENT_DAMAGE_STEP_END)",
      "Duel.Destroy(c,REASON_EFFECT)",
      "e5:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "e:GetHandler():IsCanRemoveCounter(tp,0x1f,1,REASON_COST)",
      "e:GetHandler():RemoveCounter(tp,0x1f,1,REASON_COST)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "damageStepEnded"',
      'eventName: "counterRemoved"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
