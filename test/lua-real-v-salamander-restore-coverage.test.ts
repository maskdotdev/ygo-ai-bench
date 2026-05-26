import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real V Salamander restore coverage", () => {
  it("owns its normal-summon Utopia graveyard Special Summon branch", () => {
    const file = "test/lua-real-script-v-salamander-summon-utopia-revive.test.ts";
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
      'const salamanderCode = "33725002"',
      "V Salamander",
      "restores normal-summon trigger target into Utopia graveyard Special Summon",
      "e1:SetCategory(CATEGORY_SPECIAL_SUMMON)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "return c:IsSetCard(SET_UTOPIA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
      "Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
      "e2:SetCategory(CATEGORY_EQUIP)",
      "Duel.Equip(tp,c,tc,true)",
      "e1:SetCode(EFFECT_EQUIP_LIMIT)",
      "ec:RemoveOverlayCard(tp,1,1,REASON_COST)",
      "ec:NegateEffects(e:GetHandler())",
      "Duel.Destroy(g,REASON_EFFECT)",
      "Duel.Damage(1-tp,ct*1000,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "becameTarget"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
