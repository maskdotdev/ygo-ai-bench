import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Otoshidamashi restore coverage", () => {
  it("owns opponent to-Grave trigger into AnnounceNumberRange token stats", () => {
    const file = "test/lua-real-script-otoshidamashi-counter-token-stat.test.ts";
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
      'const otoshidamashiCode = "14957440"',
      "Otoshidamashi",
      "restores opponent to-Grave trigger into AnnounceNumberRange token stat effects",
      "c:EnableCounterPermit(COUNTER_OTOSHIDAMASHI,LOCATION_MZONE)",
      "e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)",
      "e1:SetValue(aux.imval2)",
      "e2:SetCategory(CATEGORY_COUNTER+CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)",
      "e2:SetCode(EVENT_TO_GRAVE)",
      "c:AddCounter(COUNTER_OTOSHIDAMASHI,1)",
      "Duel.AnnounceNumberRange(tp,1,ct)",
      "local token=Duel.CreateToken(tp,id+1)",
      "Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)",
      "e1:SetCode(EFFECT_UPDATE_LEVEL)",
      "e2:SetCode(EFFECT_SET_ATTACK)",
      "e3:SetCode(EFFECT_SET_DEFENSE)",
      "Duel.SpecialSummonComplete()",
      'api: "AnnounceNumberRange"',
      "getDuelCardCounter(findCard(restoredTrigger.session, otoshidamashi.uid), counterOtoshidamashi)).toBe(2)",
      "currentAttack(token, restoredTrigger.session.state)",
      "currentDefense(token, restoredTrigger.session.state)",
      "currentLevel(token, restoredTrigger.session.state)",
      'eventName: "counterAdded"',
      'eventName: "breakEffect"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
