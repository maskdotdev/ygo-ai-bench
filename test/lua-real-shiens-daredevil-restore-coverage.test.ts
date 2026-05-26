import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Shien's Daredevil restore coverage", () => {
  it("owns summon Bushido Counter placement and targeted counter transfer stat updates", () => {
    const file = "test/lua-real-script-shiens-daredevil-counter-transfer-stat.test.ts";
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
      'const daredevilCode = "98162021"',
      "Shien's Daredevil",
      "restores summon Bushido Counter placement and targeted counter transfer ATK updates",
      "c:EnableCounterPermit(COUNTER_BUSHIDO)",
      "c:SetCounterLimit(COUNTER_BUSHIDO,1)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_BUSHIDO)",
      "e:GetHandler():AddCounter(COUNTER_BUSHIDO,1)",
      "return c:GetCounter(COUNTER_BUSHIDO)*300",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler(),COUNTER_BUSHIDO,1)",
      "c:RemoveCounter(tp,COUNTER_BUSHIDO,1,REASON_EFFECT)",
      "tc:AddCounter(COUNTER_BUSHIDO,1)",
      'eventName: "normalSummoned"',
      'eventName: "becameTarget"',
      'eventName: "counterRemoved"',
      'eventName: "counterAdded"',
      "currentAttack(findCard(finalRestore.session, target.uid), finalRestore.session.state)).toBe(1900)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
