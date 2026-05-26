import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Marincess Springirl restore coverage", () => {
  it("owns its GY banish Special Summon and WATER Link material Deck mill burn branch", () => {
    const file = "test/lua-real-script-marincess-springirl-banish-summon-material-mill.test.ts";
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
      'const springirlCode = "21057444"',
      "Marincess Springirl",
      "restores GY Marincess banish cost, self Special Summon, WATER Link material mill, and burn",
      "e1:SetCategory(CATEGORY_SPECIAL_SUMMON)",
      "e1:SetRange(LOCATION_HAND)",
      "return c:IsSetCard(SET_MARINCESS) and c:IsMonster() and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)",
      "Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
      "e2:SetCategory(CATEGORY_DECKDES+CATEGORY_DAMAGE)",
      "e2:SetCode(EVENT_BE_MATERIAL)",
      "return c:IsLocation(LOCATION_GRAVE) and r==REASON_LINK and c:GetReasonCard():IsAttribute(ATTRIBUTE_WATER)",
      "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_MARINCESS),tp,LOCATION_MZONE,0,nil)",
      "Duel.DiscardDeck(tp,ct,REASON_EFFECT)",
      "Duel.GetOperatedGroup():Match(Card.IsSetCard,nil,SET_MARINCESS):Match(Card.IsLocation,nil,LOCATION_GRAVE):GetCount()",
      "Duel.Damage(1-tp,dc*200,REASON_EFFECT)",
      'eventName: "banished"',
      'eventName: "usedAsMaterial"',
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      "expect(restoredLink.session.state.players[1].lifePoints).toBe(7800)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
