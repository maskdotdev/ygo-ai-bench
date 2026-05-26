import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Servant of Endymion restore coverage", () => {
  it("owns PZone Spell Counter cost into self and Deck Special Summon counters", () => {
    const file = "test/lua-real-script-servant-endymion-pzone-counter-summon.test.ts";
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
      'const servantCode = "92559258"',
      "Servant of Endymion",
      "restores PZone Spell Counter cost into self and Deck Special Summon counters",
      "c:EnableCounterPermit(COUNTER_SPELL,LOCATION_PZONE|LOCATION_MZONE)",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EVENT_CHAIN_SOLVING)",
      "c:AddCounter(COUNTER_SPELL,1)",
      "c:RemoveCounter(tp,COUNTER_SPELL,3,REASON_COST)",
      "Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)==2",
      "g:ForEach(Card.AddCounter,COUNTER_SPELL,1)",
      "e3:SetCode(EFFECT_DIRECT_ATTACK)",
      "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)",
      "Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCanAddCounter,COUNTER_SPELL,1),tp,LOCATION_ONFIELD,0,nil)",
      "Duel.CheckPendulumZones(tp)",
      "Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)",
      "getDuelCardCounter(findCard(restored.session, servant.uid), counterSpell)).toBe(1)",
      "getDuelCardCounter(findCard(restored.session, deckSpellcaster.uid), counterSpell)).toBe(1)",
      'eventName: "counterRemoved"',
      'eventName: "specialSummoned"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
