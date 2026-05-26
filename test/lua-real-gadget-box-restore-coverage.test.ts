import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Gadget Box restore coverage", () => {
  it("owns Morph Counter activation into token SpecialSummonStep lock", () => {
    const file = "test/lua-real-script-gadget-box-counter-token-lock.test.ts";
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
      'const gadgetBoxCode = "8025950"',
      "Gadget Box",
      "restores activation Morph Counters into token SpecialSummonStep and Extra Deck summon lock",
      "c:EnableCounterPermit(0x8)",
      "e0:SetCategory(CATEGORY_COUNTER)",
      "e0:SetCode(EVENT_FREE_CHAIN)",
      "e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
      "e:GetHandler():AddCounter(0x8,3)",
      "e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)",
      "Duel.IsCanRemoveCounter(tp,1,0,0x8,1,REASON_EFFECT)",
      "Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,SET_GADGET,TYPES_TOKEN,0,0,1,RACE_MACHINE,ATTRIBUTE_EARTH,POS_FACEUP)",
      "Duel.RemoveCounter(tp,1,0,0x8,1,REASON_EFFECT)",
      "local token=Duel.CreateToken(tp,id+1)",
      "Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)",
      "e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
      "return c:IsLocation(LOCATION_EXTRA) and not c:IsType(TYPE_SYNCHRO)",
      "Duel.SpecialSummonComplete()",
      "getDuelCardCounter(findCard(restoredOpen.session, gadgetBox.uid), counterMorph)).toBe(3)",
      "getDuelCardCounter(findCard(restoredIgnition.session, gadgetBox.uid), counterMorph)).toBe(2)",
      'eventName: "counterAdded"',
      'eventName: "counterRemoved"',
      'eventName: "specialSummoned"',
      "effectCannotSpecialSummon",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
