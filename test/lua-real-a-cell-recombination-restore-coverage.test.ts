import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real A Cell Recombination restore coverage", () => {
  it("owns target send-to-Grave A-Counter placement and grave self-banish search", () => {
    const file = "test/lua-real-script-a-cell-recombination-counter-search.test.ts";
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
      'const deviceCode = "91231901"',
      "A Cell Recombination",
      "restores targeted activation into Deck-to-Grave Alien send and level-count A-Counters",
      "restores Graveyard SelfBanish into Alien monster Deck search",
      "e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_COUNTER)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)",
      "Duel.SendtoGrave(g,REASON_EFFECT)",
      "tc:AddCounter(COUNTER_A,sg:GetLevel())",
      "e2:SetCost(Cost.SelfBanish)",
      "Duel.SendtoHand(g,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,g)",
      "getDuelCardCounter(findCard(restored.session, target.uid), counterA)).toBe(3)",
      'eventName: "counterAdded"',
      'eventName: "banished"',
      'eventName: "sentToHandConfirmed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
