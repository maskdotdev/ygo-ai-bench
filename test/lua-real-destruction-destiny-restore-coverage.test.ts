import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Destruction of Destiny restore coverage", () => {
  it("owns target-player Deck mill and operated Spell/Trap burn", () => {
    const file = "test/lua-real-script-destruction-destiny-deck-mill-damage.test.ts";
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
      'const destinyCode = "62980542"',
      "Destruction of Destiny",
      "restores target-player Deck mill into operated Spell/Trap count damage",
      "e1:SetCategory(CATEGORY_DECKDES+CATEGORY_DAMAGE)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)",
      "Duel.IsPlayerCanDiscardDeck(tp,3)",
      "Duel.SetTargetPlayer(tp)",
      "Duel.SetTargetParam(3)",
      "Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,3)",
      "return c:IsLocation(LOCATION_GRAVE) and c:IsSpellTrap()",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      "Duel.DiscardDeck(p,val,REASON_EFFECT)",
      "local g=Duel.GetOperatedGroup()",
      "local ct=g:FilterCount(s.filter,nil)",
      "Duel.Damage(tp,ct*1000,REASON_EFFECT)",
      'eventName: "damageDealt"',
      "expect(restoredAfter.session.state.players[0].lifePoints).toBe(6000)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
