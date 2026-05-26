import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Spell Power Grasp restore coverage", () => {
  it("owns targeted Spell Counter placement and optional same-name Deck search", () => {
    const file = "test/lua-real-script-spell-power-grasp-counter-search.test.ts";
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
      'const spellPowerCode = "75014062"',
      "Spell Power Grasp",
      "restores targeted Spell Counter placement into optional same-name Deck search",
      "e1:SetCategory(CATEGORY_COUNTER+CATEGORY_SEARCH+CATEGORY_TOHAND)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)",
      "Duel.GetFirstTarget()",
      "tc:AddCounter(COUNTER_SPELL,1)",
      "Duel.GetFirstMatchingCard(s.tfilter,tp,LOCATION_DECK,0,nil)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,0))",
      "Duel.SendtoHand(th,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,th)",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "getDuelCardCounter(findCard(restored.session, target.uid), counterSpell)).toBe(1)",
      'api: "SelectYesNo"',
      'eventName: "counterAdded"',
      'eventName: "sentToHandConfirmed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
