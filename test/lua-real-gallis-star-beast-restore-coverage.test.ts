import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Gallis the Star Beast restore coverage", () => {
  it("owns SelfReveal Deck mill damage and self Special Summon", () => {
    const file = "test/lua-real-script-gallis-star-beast-reveal-mill-summon.test.ts";
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
      'const gallisCode = "30915572"',
      "Gallis the Star Beast",
      "restores SelfReveal hand ignition into Deck mill, damage, and self Special Summon",
      "e1:SetCost(Cost.SelfReveal)",
      "Duel.IsPlayerCanDiscardDeck(tp,1)",
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,1)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,200)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,c,1,tp,0)",
      "Duel.DiscardDeck(tp,1,REASON_EFFECT)",
      "local top_c=Duel.GetOperatedGroup():GetFirst()",
      "Duel.BreakEffect()",
      "Duel.Damage(1-tp,top_c:GetOriginalLevel()*200,REASON_EFFECT)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      'eventName: "specialSummoned"',
      "expect(restoredAfter.session.state.players[1].lifePoints).toBe(7200)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
