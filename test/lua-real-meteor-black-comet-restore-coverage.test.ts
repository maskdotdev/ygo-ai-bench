import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Meteor Black Comet Dragon restore coverage", () => {
  it("owns its Fusion.AddProcMix summon damage branch and anchors previous-MZONE grave revive", () => {
    const file = "test/lua-real-script-meteor-black-comet-fusion-mill-revive.test.ts";
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
      'const meteorCode = "30086349"',
      "Meteor Black Comet Dragon",
      "restores Fusion.AddProcMix and summon Deck send damage while anchoring previous-MZONE grave revive",
      "Fusion.AddProcMix(c,true,true,s.mfilter1,s.mfilter2)",
      "e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_DECKDES)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsFusionSummoned()",
      "return c:IsSetCard(SET_RED_EYES,fc,SUMMON_TYPE_FUSION,tp) and c:GetBaseAttack()>0 and c:IsAbleToGrave()",
      "Duel.SelectMatchingCard(tp,s.damfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e:GetHandler(),tp)",
      "Duel.SendtoGrave(g,REASON_EFFECT)",
      "Duel.Damage(1-tp,math.ceil(g:GetFirst():GetBaseAttack()/2),REASON_EFFECT)",
      "e2:SetCategory(CATEGORY_SPECIAL_SUMMON)",
      "e2:SetCode(EVENT_TO_GRAVE)",
      "return e:GetHandler():IsPreviousLocation(LOCATION_MZONE)",
      "return c:IsType(TYPE_NORMAL) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
      "Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "usedAsMaterial"',
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      'eventName: "specialSummoned"',
      "expect(restoredSummonTrigger.session.state.players[1].lifePoints).toBe(6800)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
