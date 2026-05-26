import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Gouki Cage Match restore coverage", () => {
  it("owns battle-destroying counter removals into Battle Phase end Gouki Special Summons", () => {
    const file = "test/lua-real-script-gouki-cage-match-battle-counter-summon.test.ts";
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
      'const cageMatchCode = "85638822"',
      "Gouki Cage Match",
      "restores battle-destroying counter removals into Battle Phase end Gouki Special Summons and counter refill",
      "c:EnableCounterPermit(COUNTER_GOUKI_CAGE_MATCH)",
      "Duel.IsCanAddCounter(tp,COUNTER_GOUKI_CAGE_MATCH,3,e:GetHandler())",
      "c:AddCounter(COUNTER_GOUKI_CAGE_MATCH,3)",
      "e2:SetCode(EVENT_BATTLE_DESTROYING)",
      "local bc=Duel.GetBattleMonster(tp)",
      "bc:IsSetCard(SET_GOUKI) and bc:IsControler(tp)",
      "c:RemoveCounter(tp,COUNTER_GOUKI_CAGE_MATCH,1,REASON_EFFECT)",
      "c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,EFFECT_FLAG_CANNOT_DISABLE,1)",
      "e3:SetCode(EVENT_PHASE+PHASE_BATTLE)",
      "return c:GetCounter(COUNTER_GOUKI_CAGE_MATCH)==0 and c:HasFlagEffect(id,3)",
      "Duel.GetMatchingGroup(s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,nil,e,tp)",
      "aux.SelectUnselectGroup(tg,e,tp,1,ft,aux.dncheck,1,tp,HINTMSG_SPSUMMON)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0",
      "Duel.BreakEffect()",
      "c:ResetFlagEffect(id)",
      "getDuelCardCounter(findCard(restoredOpen.session, cageMatch.uid), counterGoukiCageMatch)).toBe(3)",
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
