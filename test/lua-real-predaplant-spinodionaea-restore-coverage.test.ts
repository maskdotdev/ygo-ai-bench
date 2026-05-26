import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-predaplant-spinodionaea-counter-battled-summon.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c52792430.lua");

describe("Lua real Predaplant Spinodionaea restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const spinodionaeaCode = "52792430"');
    expect(fixture).toContain("Predaplant Spinodionaea");
    expect(fixture).toContain("restores summon Predator Counter level change and battled lower-level deck summon");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, counterTarget.uid), counterPredator)).toBe(1)");
    expect(fixture).toContain("currentLevel(findCard(restoredTrigger.session, counterTarget.uid), restoredTrigger.session.state)).toBe(1)");
    expect(fixture).toContain("eventName: \"specialSummoned\"");

    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
    expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
    expect(script).toContain("return bc and bc:IsLevelBelow(c:GetLevel()) and bc:IsStatus(STATUS_OPPO_BATTLE) and bc:IsRelateToBattle()");
    expect(script).toContain("c:IsSetCard(SET_PREDAPLANT) and not c:IsCode(id) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  });
});
