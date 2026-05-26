import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-alien-dog-summon-counter.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c15475415.lua");

describe("Lua real Alien Dog restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const alienDogCode = "15475415"');
    expect(fixture).toContain("Alien Dog");
    expect(fixture).toContain("restores Alien summon hand trigger into procedure Special Summon and A-Counter placement");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredCounterTrigger.session, targetA.uid), counterA)).toBe(2)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredCounterTrigger.session, targetB.uid), counterA)).toBe(0)");
    expect(fixture).toContain("eventName: \"normalSummoned\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");

    expect(script).toContain("s.listed_series={SET_ALIEN}");
    expect(script).toContain("s.counter_place_list={COUNTER_A}");
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return ep==tp and eg:GetFirst():IsSetCard(SET_ALIEN)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(script).toContain("c:IsCanBeSpecialSummoned(e,1,tp,false,false)");
    expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
    expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
  });
});
