import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Number 104 Masquerade restore coverage", () => {
  it("owns its official opponent Deck mill branch and anchors the negate branch", () => {
    const file = "test/lua-real-script-number-104-masquerade-deck-mill.test.ts";
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
      'const masqueradeCode = "2061963"',
      "Number 104: Masquerade",
      "restores the official ignition target-player Deck mill branch",
      "Xyz.AddProcedure(c,nil,4,3)",
      "e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DAMAGE)",
      "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)",
      "e1:SetCode(EVENT_CHAINING)",
      "Duel.IsBattlePhase() and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "Duel.NegateActivation(ev)",
      "Duel.Damage(1-tp,800,REASON_EFFECT)",
      "e2:SetCategory(CATEGORY_DECKDES)",
      "Duel.IsPlayerCanDiscardDeck(1-tp,1)",
      "Duel.SetTargetPlayer(1-tp)",
      "Duel.SetTargetParam(1)",
      "Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,1-tp,1)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      "Duel.DiscardDeck(p,d,REASON_EFFECT)",
      'eventName: "sentToGraveyard"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
