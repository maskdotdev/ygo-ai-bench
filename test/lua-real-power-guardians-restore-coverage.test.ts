import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Power of the Guardians restore coverage", () => {
  it("owns equipped Spell Counter stat gain, attack-announcement counter placement, and replacement script shape", () => {
    const file = "test/lua-real-script-power-guardians-counter-equip-stat.test.ts";
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
      'const powerCode = "1118137"',
      "Power of the Guardians",
      "restores equipped Spell Counter ATK/DEF gain and attack-announcement counter placement",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "aux.AddEquipProcedure(c)",
      "e2:SetCategory(CATEGORY_COUNTER)",
      "e2:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "return Duel.GetAttacker()==tc or Duel.GetAttackTarget()==tc",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)",
      "e:GetHandler():AddCounter(COUNTER_SPELL,1)",
      "e3:SetCode(EFFECT_UPDATE_ATTACK)",
      "e4:SetCode(EFFECT_UPDATE_DEFENSE)",
      "return e:GetHandler():GetCounter(COUNTER_SPELL)*500",
      "e5:SetCode(EFFECT_DESTROY_REPLACE)",
      "Duel.SelectEffectYesNo(tp,c,96)",
      "Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,1,REASON_EFFECT|REASON_REPLACE)",
      'eventName: "attackDeclared"',
      'eventName: "counterAdded"',
      "currentAttack(findCard(restoredTrigger.session, attacker.uid), restoredTrigger.session.state)).toBe(2500)",
      "currentDefense(findCard(restoredTrigger.session, attacker.uid), restoredTrigger.session.state)).toBe(2200)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
