import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Gem-Knight Lady Lapis Lazuli restore coverage", () => {
  it("owns its ignition Gem-Knight Deck send and Special Summon count burn", () => {
    const file = "test/lua-real-script-gem-knight-lapis-lazuli-send-burn.test.ts";
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
      'const lapisLazuliCode = "47611119"',
      "Gem-Knight Lady Lapis Lazuli",
      "restores ignition Deck send into operated grave count and target-player damage",
      "Fusion.AddProcMix(c,false,false,99645428,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GEM_KNIGHT))",
      "e1:SetCode(EFFECT_SPSUMMON_CONDITION)",
      "e2:SetCategory(CATEGORY_DAMAGE+CATEGORY_DECKDES)",
      "e2:SetType(EFFECT_TYPE_IGNITION)",
      "e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)",
      "return c:IsSetCard(SET_GEM_KNIGHT) and c:IsMonster() and c:IsAbleToGrave()",
      "return c:IsSpecialSummoned()",
      "Duel.SetTargetPlayer(1-tp)",
      "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil)",
      "Duel.SendtoGrave(g,REASON_EFFECT)",
      "Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_GRAVE)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)",
      "Duel.Damage(p,ct*500,REASON_EFFECT)",
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      "expect(restoredAfter.session.state.players[1].lifePoints).toBe(6500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
