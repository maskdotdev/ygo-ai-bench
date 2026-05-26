import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real FA Shining Star restore coverage", () => {
  it("owns the static damage prevention and counter negation fixture", () => {
    const file = "test/lua-real-script-fa-shining-star-counter-negate.test.ts";
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
      'const shiningCode = "37414347"',
      "F.A. Shining Star GT",
      "restores static damage prevention and counter-cost monster negation into source destruction",
      "c:EnableCounterPermit(0x4a)",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_MACHINE),2,2)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "return lg:GetSum(Card.GetLevel)*300",
      "e2:SetCode(EFFECT_NO_BATTLE_DAMAGE)",
      "e3:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)",
      "e4:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)",
      "return re:IsSpellTrapEffect() and re:GetHandler():IsSetCard(SET_FA)",
      "c:AddCounter(0x4a,1)",
      "return ep==1-tp and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)",
      "c:IsCanRemoveCounter(tp,0x4a,1,REASON_COST)",
      "c:RemoveCounter(tp,0x4a,1,REASON_COST)",
      "Duel.NegateActivation(ev)",
      "Duel.Destroy(eg,REASON_EFFECT)",
      "eventName: \"counterRemoved\"",
      "eventName: \"destroyed\"",
      "eventName: \"chainNegated\"",
      "eventName: \"chainDisabled\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
