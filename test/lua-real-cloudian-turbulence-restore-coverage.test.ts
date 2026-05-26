import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-cloudian-turbulence-counter-summon.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c16197610.lua");

describe("Lua real Cloudian Turbulence restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const turbulenceCode = "16197610"');
    expect(fixture).toContain("Cloudian - Turbulence");
    expect(fixture).toContain("restores Cloudian-count summon counters and Fog Counter Smoke Ball summon");
    expect(fixture).toContain("effectIndestructableBattle");
    expect(fixture).toContain("effectSelfDestroy");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredCounterTrigger.session, turbulenceCode), counterFog)).toBe(2)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredSmokeBall.session, summonTurbulence.uid), counterFog)).toBe(1)");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");

    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
    expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
    expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_CLOUDIAN),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)");
    expect(script).toContain("e4:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,COUNTER_FOG,1,REASON_COST)");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FOG,1,REASON_COST)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK|LOCATION_GRAVE,LOCATION_GRAVE,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_DECK|LOCATION_GRAVE,LOCATION_GRAVE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  });
});
