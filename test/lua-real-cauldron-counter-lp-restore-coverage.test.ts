import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cauldron counter LP restore coverage", () => {
  it("owns the Cauldron phase-counter and ChainInfo LP fixture", () => {
    const file = "test/lua-real-script-cauldron-old-man-counter-lp.test.ts";
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
      'const cauldronCode = "91740879"',
      "Cauldron of the Old Man",
      "restores activation and self-standby Cauldron Counters into ChainInfo recover and damage ignition branches",
      "c:EnableCounterPermit(COUNTER_CAULDRON)",
      "Duel.IsCanAddCounter(tp,COUNTER_CAULDRON,1,c)",
      "e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)",
      "e2:SetCode(EVENT_PHASE|PHASE_STANDBY)",
      "return Duel.IsTurnPlayer(tp)",
      "Duel.SetTargetPlayer(tp)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)",
      "Duel.Recover(p,d,REASON_EFFECT)",
      "Duel.SetTargetPlayer(1-tp)",
      "Duel.Damage(p,d,REASON_EFFECT)",
      "eventName: \"phaseStandby\"",
      "eventName: \"counterAdded\"",
      "eventName: \"recoveredLifePoints\"",
      "eventName: \"damageDealt\"",
      "battleDamage).toEqual({ 0: 0, 1: 0 })",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
