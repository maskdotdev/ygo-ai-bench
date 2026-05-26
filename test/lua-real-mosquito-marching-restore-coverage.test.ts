import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Ninjitsu Art of Mosquito Marching restore coverage", () => {
  it("owns grave SelfBanish opponent Hallucination Counter disable branch", () => {
    const file = "test/lua-real-script-mosquito-marching-grave-counter-disable.test.ts";
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
      'const marchingCode = "68441986"',
      "Ninjitsu Art of Mosquito Marching",
      "restores grave SelfBanish into opponent Hallucination Counters and disable effects",
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND,0,1,nil,e,tp)",
      "aux.SelectUnselectGroup(g,e,tp,1,ft,s.spcheck,1,tp,HINTMSG_SPSUMMON)",
      "return sg:GetClassCount(Card.GetLevel)==1",
      "e2:SetCost(Cost.SelfBanish)",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,32453837),tp,LOCATION_ONFIELD,0,1,nil)",
      "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_INSECT),tp,LOCATION_MZONE,0,nil)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,ct,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,0,0x1101)",
      "local g=Duel.GetTargetCards(e)",
      "tc:AddCounter(0x1101,1)",
      "e1:SetCode(EFFECT_DISABLE)",
      "getDuelCardCounter(findCard(restored.session, opponent.uid), counterHallucination)).toBe(1)",
      'eventName: "banished"',
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
