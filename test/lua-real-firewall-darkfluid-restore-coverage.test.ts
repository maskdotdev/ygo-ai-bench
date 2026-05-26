import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Firewall Dragon Darkfluid restore coverage", () => {
  it("owns Link Summon Cyberse type counters, battle ATK gain, and chain-negate script shape", () => {
    const file = "test/lua-real-script-firewall-darkfluid-counter-stat.test.ts";
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
      'const darkfluidCode = "68934651"',
      "Firewall Dragon Darkfluid",
      "restores Firewall Counter state into battle-phase ATK gain",
      "c:EnableCounterPermit(COUNTER_FW)",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsLinkSummoned()",
      "Duel.GetMatchingGroup(s.ctfilter,tp,LOCATION_GRAVE,0,nil)",
      "c:AddCounter(COUNTER_FW,getcount(tp))",
      "e2:SetCode(EFFECT_UPDATE_ATTACK)",
      "return Duel.IsBattlePhase()",
      "return c:GetCounter(COUNTER_FW)*2500",
      "e3:SetCode(EVENT_CHAINING)",
      "EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL",
      "Duel.IsChainNegatable(ev)",
      "e:GetHandler():RemoveCounter(tp,COUNTER_FW,1,REASON_COST)",
      "Duel.NegateActivation(ev)",
      "Duel.ChainAttack()",
      "e1:SetCode(EVENT_DAMAGE_STEP_END)",
      "currentAttack(findCard(restored.session, darkfluid.uid), restored.session.state)).toBe(10500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
