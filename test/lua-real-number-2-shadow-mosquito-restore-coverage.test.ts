import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Number 2 Shadow Mosquito restore coverage", () => {
  it("owns the Attack Announce counter and damage SelectEffect fixture", () => {
    const file = "test/lua-real-script-number-2-shadow-mosquito-counter-damage.test.ts";
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
      'const shadowMosquitoCode = "32453837"',
      "Number 2: Ninja Shadow Mosquito",
      "restores Attack Announce SelectEffect counter branch into detach, Hallucination Counter placement, and target disable",
      "restores Attack Announce SelectEffect damage branch from a Hallucination Counter monster ATK",
      "Xyz.AddProcedure(c,nil,2,2,nil,nil,Xyz.InfiniteMats)",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)",
      "e3:SetCode(EFFECT_MUST_ATTACK)",
      "e4:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "s.counter_place_list={0x1101}",
      "local op=Duel.SelectEffect(tp,",
      "c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)",
      "tc:AddCounter(0x1101,1)",
      "e1:SetCode(EFFECT_DISABLE)",
      "Duel.Damage(1-tp,tc:GetAttack(),REASON_EFFECT)",
      "c:EnableCounterPermit(0x1101,LOCATION_MZONE)",
      "eventName: \"attackDeclared\"",
      "eventName: \"counterAdded\"",
      "eventName: \"damageDealt\"",
      "lifePoints).toBe(6400)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
