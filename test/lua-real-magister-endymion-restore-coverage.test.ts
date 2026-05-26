import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Magister of Endymion restore coverage", () => {
  it("owns PZone Spell Counter cost into self and face-up Extra Deck Special Summon counters", () => {
    const file = "test/lua-real-script-magister-endymion-pzone-extra-counter-summon.test.ts";
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
      'const magisterCode = "66104644"',
      "Magister of Endymion",
      "restores PZone Spell Counter cost into self and face-up Extra Deck Special Summon counters",
      "c:EnableCounterPermit(COUNTER_SPELL,LOCATION_PZONE|LOCATION_MZONE)",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EVENT_CHAIN_SOLVING)",
      "c:AddCounter(COUNTER_SPELL,1)",
      "c:RemoveCounter(tp,COUNTER_SPELL,3,REASON_COST)",
      "Duel.GetLocationCountFromEx(tp)>0",
      "Duel.GetUsableMZoneCount(tp)>1",
      "Duel.SelectMatchingCard(tp,aux.FaceupFilter(s.spfilter,e,tp),tp,LOCATION_EXTRA,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)==2",
      "g:ForEach(Card.AddCounter,COUNTER_SPELL,1)",
      "e3:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)",
      "Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
      "Duel.CheckPendulumZones(tp)",
      "Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)",
      "getDuelCardCounter(findCard(restored.session, magister.uid), counterSpell)).toBe(1)",
      "getDuelCardCounter(findCard(restored.session, extraSpellcaster.uid), counterSpell)).toBe(1)",
      'eventName: "counterRemoved"',
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
