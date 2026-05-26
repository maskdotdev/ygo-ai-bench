import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Balloon Lizard counter damage restore coverage", () => {
  it("owns the Balloon Counter leave-field snapshot damage fixture", () => {
    const file = "test/lua-real-script-balloon-lizard-counter-destroy-damage.test.ts";
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
      'const balloonCode = "39892082"',
      "Balloon Lizard",
      "restores Standby Balloon Counter placement and destroyed damage from leave-field counter snapshot",
      "c:EnableCounterPermit(0x29)",
      "e1:SetCode(EVENT_PHASE|PHASE_STANDBY)",
      "return Duel.IsTurnPlayer(tp)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x29)",
      "e:GetHandler():AddCounter(0x29,1)",
      "e2:SetCode(EVENT_LEAVE_FIELD_P)",
      "local ct=e:GetHandler():GetCounter(0x29)",
      "e:SetLabel(ct)",
      "e3:SetCode(EVENT_DESTROYED)",
      "local ct=e:GetLabelObject():GetLabel()",
      "Duel.SetTargetPlayer(rp)",
      "Duel.SetTargetParam(e:GetLabel()*400)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      "Duel.Damage(p,d,REASON_EFFECT)",
      "eventName: \"phaseStandby\"",
      "eventName: \"counterAdded\"",
      "eventName: \"destroyed\"",
      "eventName: \"damageDealt\"",
      "battleDamage).toEqual({ 0: 0, 1: 0 })",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
