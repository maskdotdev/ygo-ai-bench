import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-blackwing-auster-counter-summon.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c17465972.lua");

describe("Lua real Blackwing Auster restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const austerCode = "17465972"');
    expect(fixture).toContain("Blackwing - Auster the South Wind");
    expect(fixture).toContain("restores summon revival and grave SelfBanish counter branch choices");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredFeather.session, blackWingedDragon.uid), featherCounter)).toBe(2)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredWedge.session, wedgeA.uid), wedgeCounter)).toBe(1)");
    expect(fixture).toContain("eventName: \"specialSummoned\"");
    expect(fixture).toContain("eventName: \"banished\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");

    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_REMOVED,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)>0");
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,2),aux.Stringid(id,3))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsCode,CARD_BLACK_WINGED_DRAGON),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
    expect(script).toContain("tc:AddCounter(COUNTER_FEATHER,ct)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.wcfilter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("tc:AddCounter(0x1002,1)");
  });
});
