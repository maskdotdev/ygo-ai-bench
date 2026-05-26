import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Vaalmonica Followed Rhythm restore coverage", () => {
  it("owns SelectEffect both branch and optional recover/damage operations", () => {
    const file = "test/lua-real-script-vaalmonica-followed-rhythm-select-both.test.ts";
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
      'const rhythmCode = "4582942"',
      "Vaalmonica Followed Rhythm",
      "restores SelectEffect both branch into recover-destroy, damage-bounce, and prompt decisions",
      "e1:SetCategory(CATEGORY_RECOVER+CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_TOHAND)",
      "e1:SetType(EFFECT_TYPE_ACTIVATE)",
      "return c:IsSetCard(SET_VAALMONICA) and c:IsFaceup() and c:IsOriginalType(TYPE_MONSTER)",
      "return c:IsSetCard(SET_VAALMONICA) and c:IsFaceup() and c:IsLinkMonster()",
      "op=Duel.SelectEffect(tp,",
      "{both,aux.Stringid(id,3)}",
      "Duel.Recover(tp,500,REASON_EFFECT)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,4))",
      "Duel.Destroy(dg,REASON_EFFECT)",
      "Duel.Damage(tp,500,REASON_EFFECT)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,5))",
      "Duel.SendtoHand(hg,nil,REASON_EFFECT)",
      'eventName: "recoveredLifePoints"',
      'eventName: "destroyed"',
      'eventName: "damageDealt"',
      'eventName: "sentToHand"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
