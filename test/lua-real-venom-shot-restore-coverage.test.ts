import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Venom Shot restore coverage", () => {
  it("owns the targeted Venom Counter and Deck send fixture", () => {
    const file = "test/lua-real-script-venom-shot-counter-deck-send.test.ts";
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
      'const venomShotCode = "60728397"',
      "Venom Shot",
      "restores Venom condition, targeted Venom Counter placement, Reptile Deck send, and zero-ATK custom event",
      "e1:SetCategory(CATEGORY_DECKDES)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE,0,1,nil)",
      "return c:IsRace(RACE_REPTILE) and c:IsAbleToGrave()",
      "Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_VENOM,2)",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_VENOM,2)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0)",
      "Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)",
      "Duel.SendtoGrave(g,REASON_EFFECT)",
      "local tc=Duel.GetFirstTarget()",
      "tc:AddCounter(COUNTER_VENOM,2)",
      "Duel.RaiseEvent(tc,EVENT_CUSTOM+54306223,e,0,0,0,0)",
      "c:EnableCounterPermit(COUNTER_VENOM,LOCATION_MZONE)",
      "eventName: \"sentToGraveyard\"",
      "eventName: \"counterAdded\"",
      "eventName: \"customEvent\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
