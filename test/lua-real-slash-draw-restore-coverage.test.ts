import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Slash Draw restore coverage", () => {
  it("owns discard, mill, draw-confirm, and fallback Graveyard return behavior", () => {
    const file = "test/lua-real-script-slash-draw-mill-draw-todeck.test.ts";
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
      'const slashDrawCode = "71344451"',
      "Slash Draw",
      "restores discard cost, opponent-field-count mill, draw confirm, and fallback Graveyard return to Deck",
      "e1:SetCategory(CATEGORY_DECKDES+CATEGORY_DRAW+CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_TODECK)",
      "e1:SetType(EFFECT_TYPE_ACTIVATE)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)",
      "local ct=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)",
      "Duel.IsPlayerCanDiscardDeck(tp,ct)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_GRAVE)",
      "Duel.DiscardDeck(tp,ct,REASON_EFFECT)",
      "Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_GRAVE)",
      "Duel.Draw(tp,1,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,tc)",
      "Duel.ShuffleHand(tp)",
      "Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(Card.IsAbleToDeck),tp,LOCATION_GRAVE,0,grave_ct,grave_ct,nil)",
      "Duel.SendtoDeck(dg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
      'eventName: "discarded"',
      'eventName: "sentToGraveyard"',
      'eventName: "cardsDrawn"',
      'eventName: "confirmed"',
      'eventName: "sentToDeck"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
