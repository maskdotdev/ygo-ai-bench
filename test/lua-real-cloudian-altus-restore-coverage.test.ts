import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cloudian Altus restore coverage", () => {
  it("owns Cloudian-count Fog Counters and counter-cost opponent hand discard", () => {
    const file = "test/lua-real-script-cloudian-altus-counter-hand-discard.test.ts";
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
      'const altusCode = "79703905"',
      "Cloudian - Altus",
      "restores Cloudian-count Fog Counters into counter-cost opponent hand discard",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_SELF_DESTROY)",
      "return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)",
      "e3:SetCategory(CATEGORY_COUNTER)",
      "e3:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)",
      "e4:SetCategory(CATEGORY_HANDES)",
      "Duel.IsCanRemoveCounter(tp,1,1,COUNTER_FOG,3,REASON_COST)",
      "Duel.RemoveCounter(tp,1,1,COUNTER_FOG,3,REASON_COST)",
      "Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)~=0",
      "Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,tp,1)",
      "Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(tp,1)",
      "Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)",
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "sentToGraveyard"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
