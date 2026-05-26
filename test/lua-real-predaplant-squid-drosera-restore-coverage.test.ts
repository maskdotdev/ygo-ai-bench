import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Predaplant Squid Drosera restore coverage", () => {
  it("owns hand attack-all targeting and leave-field Predator Counter level changes", () => {
    const file = "test/lua-real-script-predaplant-squid-drosera-attack-all-counter.test.ts";
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
      'const squidCode = "69105797"',
      "Predaplant Squid Drosera",
      "restores hand self-to-Grave attack-all targeting and leave-field Predator Counter level changes",
      "e1:SetType(EFFECT_TYPE_IGNITION)",
      "e1:SetRange(LOCATION_HAND)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return Duel.IsAbleToEnterBP()",
      "e1:SetCost(Cost.SelfToGrave)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_ATTACK_ALL)",
      "return c:GetCounter(COUNTER_PREDATOR)>0",
      "s.counter_place_list={COUNTER_PREDATOR}",
      "e2:SetCategory(CATEGORY_COUNTER)",
      "e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
      "e2:SetCode(EVENT_LEAVE_FIELD)",
      "return c:IsPreviousPosition(POS_FACEUP) and not c:IsLocation(LOCATION_DECK)",
      "return c:IsFaceup() and c:IsSpecialSummoned()",
      "tc:AddCounter(COUNTER_PREDATOR,1)",
      "e1:SetCode(EFFECT_CHANGE_LEVEL)",
      "eventName: \"sentToGraveyard\"",
      "eventName: \"counterAdded\"",
      "currentLevel(findCard(restoredLeave.session, opponentSpecial.uid), restoredLeave.session.state)).toBe(1)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
