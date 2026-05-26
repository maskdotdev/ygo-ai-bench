import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cloudian Acid Cloud restore coverage", () => {
  it("owns the Cloudian-count counter and Fog Counter Spell/Trap destroy fixture shape", () => {
    const file = "test/lua-real-script-cloudian-acid-cloud-counter-destroy.test.ts";
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
      'const acidCloudCode = "17810268"',
      "Cloudian - Acid Cloud",
      "restores Cloudian-count summon counters, Fog Counter cost, and targeted Spell/Trap destruction",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_SELF_DESTROY)",
      "return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)",
      "e3:SetCategory(CATEGORY_COUNTER)",
      "e3:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_CLOUDIAN),tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)",
      "e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,2,REASON_COST)",
      "e:GetHandler():RemoveCounter(tp,COUNTER_FOG,2,REASON_COST)",
      "Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)",
      "Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
