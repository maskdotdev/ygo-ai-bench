import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-seraphim-papillion-material-counter-summon.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c91140491.lua");

describe("Lua real Seraphim Papillion restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const papillionCode = "91140491"');
    expect(fixture).toContain("Seraphim Papillion");
    expect(fixture).toContain("restores material-check Papillon counters, counter attack scaling, and counter-cost grave summon");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredCounter.session, papillionCode), counterPapillon)).toBe(2)");
    expect(fixture).toContain("currentAttack(requireCard(restoredCounter.session, papillionCode), restoredCounter.session.state)).toBe(2500)");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredSummon.session, papillionCode), counterPapillon)).toBe(1)");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");

    expect(script).toContain("local COUNTER_PAPILLON=0x14d");
    expect(script).toContain("c:EnableCounterPermit(COUNTER_PAPILLON)");
    expect(script).toContain("Link.AddProcedure(c,nil,2,3,s.lcheck)");
    expect(script).toContain("return g:CheckDifferentProperty(Card.GetCode,lc,sumtype,tp)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e2:SetValue(s.valcheck)");
    expect(script).toContain("e:GetLabelObject():SetLabel(c:GetMaterial():FilterCount(Card.IsRace,nil,RACE_INSECT,c,SUMMON_TYPE_LINK))");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return c:GetCounter(COUNTER_PAPILLON)*200");
    expect(script).toContain("c:IsCanRemoveCounter(tp,COUNTER_PAPILLON,1,REASON_COST)");
    expect(script).toContain("c:RemoveCounter(tp,COUNTER_PAPILLON,1,REASON_COST)");
    expect(script).toContain("c:IsRace(RACE_INSECT) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  });
});
