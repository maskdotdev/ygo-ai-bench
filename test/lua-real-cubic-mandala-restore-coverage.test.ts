import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cubic Mandala restore coverage", () => {
  it("owns grave SpecialSummonStep operated Cubic Counter and disable locks", () => {
    const file = "test/lua-real-script-cubic-mandala-grave-step-counter-disable.test.ts";
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
      'const mandalaCode = "8837932"',
      "Cubic Mandala",
      "restores activation target into opponent SpecialSummonStep operated Cubic Counter and disable locks",
      "e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_CUBIC),tp,LOCATION_MZONE,0,1,nil)",
      "c:IsReason(REASON_DESTROY) and c:IsMonster() and c:GetTurnID()==tid",
      "Duel.IsCanAddCounter(tp,COUNTER_CUBIC,1,c)",
      "Duel.SelectTarget(tp,s.spfilter,tp,0,LOCATION_GRAVE,1,ft,nil,e,tp,tid)",
      "Duel.SpecialSummonStep(sc,0,tp,1-tp,false,false,POS_FACEUP)",
      "c:SetCardTarget(sc)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "Duel.SpecialSummonComplete()",
      "local og=Duel.GetOperatedGroup()",
      "oc:AddCounter(COUNTER_CUBIC,1)",
      "e2:SetCode(EFFECT_CANNOT_ATTACK)",
      "e3:SetCode(EFFECT_DISABLE)",
      "e2:SetCode(EVENT_CHAIN_ACTIVATING)",
      "Duel.NegateEffect(ev)",
      "e3:SetCode(EVENT_LEAVE_FIELD)",
      "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
      "cardTargetUids).toEqual([destroyedOpponent.uid])",
      "currentAttack(summoned, restored.session.state)).toBe(0)",
      "getDuelCardCounter(summoned, counterCubic)).toBe(1)",
      'eventName: "becameTarget"',
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
      "code: 102",
      "code: 85",
      "code: 2",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
