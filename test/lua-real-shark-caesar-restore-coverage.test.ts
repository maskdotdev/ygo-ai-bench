import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Shark Caesar restore coverage", () => {
  it("owns Xyz detach counter placement and battle-only self ATK gain", () => {
    const file = "test/lua-real-script-shark-caesar-counter-battle-stat.test.ts";
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
      'const sharkCode = "14306092"',
      "Shark Caesar",
      "restores Xyz detach counter placement into battle-only ATK gain",
      "c:EnableCounterPermit(0x2e)",
      "Xyz.AddProcedure(c,nil,3,3,nil,nil,5)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "c:AddCounter(0x2e,1)",
      "Duel.GetCurrentPhase()",
      "Duel.GetAttacker()==e:GetHandler() or Duel.GetAttackTarget()==e:GetHandler()",
      "return c:GetCounter(0x2e)*1000",
      'eventName: "sentToGraveyard"',
      'eventName: "detachedMaterial"',
      'eventName: "counterAdded"',
      "currentAttack(findCard(restoredBattle.session, shark.uid), restoredBattle.session.state)).toBe(baseAttack + 1000)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
