import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cold Enchanter restore coverage", () => {
  it("owns discard cost, targeted Ice Counter placement, and Duel.GetCounter ATK gain", () => {
    const file = "test/lua-real-script-cold-enchanter-discard-counter-stat.test.ts";
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
      'const enchanterCode = "24661486"',
      "Cold Enchanter",
      "restores discard cost into targeted Ice Counter placement and Duel.GetCounter ATK gain",
      "Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,e:GetHandler())",
      "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,0x1015,1)",
      "tc:AddCounter(0x1015,1)",
      "return Duel.GetCounter(0,1,1,0x1015)*300",
      'eventName: "discarded"',
      'eventName: "sentToGraveyard"',
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
      "getDuelCardCounter(findCard(restoredOpen.session, enchanter.uid), counterIce)).toBe(1)",
      "currentAttack(findCard(restoredStat.session, enchanter.uid), restoredStat.session.state)).toBe(1900)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
