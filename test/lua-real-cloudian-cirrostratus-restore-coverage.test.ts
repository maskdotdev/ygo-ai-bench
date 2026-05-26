import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cloudian Cirrostratus restore coverage", () => {
  it("owns the face-up Cloudian-count counter and Fog Counter monster destroy fixture shape", () => {
    const file = "test/lua-real-script-cloudian-cirrostratus-counter-destroy.test.ts";
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
      'const cirroCode = "43318266"',
      "Cloudian - Cirrostratus",
      "restores explicit Cloudian face-up count counters, Fog Counter cost, and targeted monster destruction",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_SELF_DESTROY)",
      "return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)",
      "return c:IsFaceup() and c:IsSetCard(SET_CLOUDIAN)",
      "e3:SetCategory(CATEGORY_COUNTER)",
      "e3:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)",
      "e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,2,REASON_COST)",
      "e:GetHandler():RemoveCounter(tp,COUNTER_FOG,2,REASON_COST)",
      "if chkc then return chkc:IsLocation(LOCATION_MZONE) end",
      "Duel.IsExistingTarget(aux.TRUE,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
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
