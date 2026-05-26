import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Vaalmonica Creation restore coverage", () => {
  it("owns EVENT_TO_GRAVE PZone Resonance Counter placement and custom event", () => {
    const file = "test/lua-real-script-vaalmonica-creation-grave-counter-custom.test.ts";
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
      'const creationCode = "98167225"',
      "Vaalmonica Creation",
      "restores EVENT_TO_GRAVE trigger into PZone Resonance Counters and custom event",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "Duel.GetCounter(e:GetHandlerPlayer(),1,0,COUNTER_RESONANCE)>=6",
      "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "eg:IsExists(Card.IsSummonPlayer,1,nil,1-tp)",
      "Duel.IsExistingMatchingCard(s.lkfilter,tp,LOCATION_EXTRA,0,1,nil)",
      "Duel.LinkSummon(tp,sc)",
      "e3:SetCode(EVENT_TO_GRAVE)",
      "return e:GetHandler():IsPreviousLocation(LOCATION_HAND|LOCATION_ONFIELD)",
      "local ct=c:GetCounter(COUNTER_RESONANCE)",
      "return ct<3 and c:IsCanAddCounter(COUNTER_RESONANCE,3-ct)",
      "Duel.SelectMatchingCard(tp,s.ctfilter,tp,LOCATION_PZONE,0,1,1,nil)",
      "tc:AddCounter(COUNTER_RESONANCE,3-tc:GetCounter(COUNTER_RESONANCE),true)",
      "Duel.RaiseEvent(tc,EVENT_CUSTOM+39210885,e,0,tp,tp,1)",
      "sendDuelCardToGraveyard(session.state, creation.uid, 0, duelReason.effect, 0)",
      "getDuelCardCounter(findCard(restored.session, pzone.uid), counterResonance)).toBe(3)",
      "eventCustomVaalmonica",
      'eventName: "sentToGraveyard"',
      'eventName: "counterAdded"',
      'eventName: "customEvent"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
