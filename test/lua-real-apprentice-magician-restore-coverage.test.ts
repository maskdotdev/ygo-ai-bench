import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Apprentice Magician restore coverage", () => {
  it("owns summon-success target selection into Spell Counter placement", () => {
    const file = "test/lua-real-script-apprentice-magician-counter-target.test.ts";
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
      'const apprenticeCode = "9156135"',
      "Apprentice Magician",
      "restores summon-success target selection into Spell Counter placement",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
      "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
      "tc:AddCounter(COUNTER_SPELL,1)",
      "e4:SetCode(EVENT_BATTLE_DESTROYED)",
      "c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEDOWN_DEFENSE)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE)",
      "Duel.ConfirmCards(1-tp,g)",
      "getDuelCardCounter(findCard(restoredTrigger.session, target.uid), counterSpell)).toBe(1)",
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
