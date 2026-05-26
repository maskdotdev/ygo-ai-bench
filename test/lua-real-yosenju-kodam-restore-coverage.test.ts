import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const fixturePath = path.resolve("test/lua-real-script-yosenju-kodam-counter-extra-summon.test.ts");
const scriptPath = path.join(upstreamRoot, "script", "official", "c23740893.lua");

describe("Lua real Yosenju Kodam restore coverage", () => {
  it("anchors the real-script counter and extra summon fixture", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("restoreDuelWithLuaScripts");
    expect(fixture).toContain("expectRestoredLegalActions");
    expect(fixture).toContain("getDuelCardCounter");
    expect(fixture).toContain("eventName: \"released\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("effectExtraSummonCount");
    expect(fixture).toContain("activityCounts[0].normalSummon");
    expect(script).toContain("--Yosenju Kodam");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x33)");
    expect(script).toContain("tc:AddCounter(0x33,3)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.IsPlayerCanAdditionalSummon(tp)");
    expect(script).toContain("Duel.GetFlagEffect(tp,id)~=0");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_YOSENJU))");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  });
});
