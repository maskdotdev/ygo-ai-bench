import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-selene-counter-linked-summon.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c45819647.lua");

describe("Lua real Selene restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const seleneCode = "45819647"');
    expect(fixture).toContain("Selene, Queen of the Master Magicians");
    expect(fixture).toContain("restores Link Summon counters, battle targeting protection, and counter-cost linked-zone summon");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredCounter.session, seleneCode), counterSpell)).toBe(3)");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredSummon.session, seleneCode), counterSpell)).toBe(0)");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");

    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("Link.AddProcedure(c,nil,2,3,s.lcheck)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.ctfilter,tp,LOCATION_ONFIELD|LOCATION_GRAVE,LOCATION_ONFIELD|LOCATION_GRAVE,nil)");
    expect(script).toContain("c:AddCounter(COUNTER_SPELL,ct)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
    expect(script).toContain("e2:SetValue(aux.imval2)");
    expect(script).toContain("local ph=Duel.GetCurrentPhase()");
    expect(script).toContain("return Duel.IsMainPhase()");
    expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
    expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil,e,tp,zone)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE,zone)");
  });
});
