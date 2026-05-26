import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-alien-skull-lava-counter-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c25920413.lua");

describe("Lua real Alien Skull restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const alienSkullCode = "25920413"');
    expect(fixture).toContain("restores Lava procedure, custom summon A-Counter trigger, summon lock cost, and battle stat metadata");
    expect(fixture).toContain("event: \"summonProcedure\"");
    expect(fixture).toContain("expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === alienSkull.uid)).toBe(false)");
    expect(fixture).toContain("movedSkull.summonTypeCode = luaSummonTypeSpecial + 1");
    expect(fixture).toContain("id: \"lua-2-1102\"");
    expect(fixture).toContain("restoredBattle.session.state.battleStep = \"damageCalculation\"");
    expect(fixture).toContain("currentAttack(findCard(restoredBattle.session, alienSkull.uid), restoredBattle.session.state)).toBe(1300)");

    expect(script).toContain("--Alien Skull");
    expect(script).toContain("aux.AddLavaProcedure(c,1,POS_FACEUP,aux.AND(Card.IsFaceup,aux.FilterBoolFunction(Card.IsLevelBelow,3)),1)");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
    expect(script).toContain("c:AddCounter(COUNTER_NEED_ENABLE+COUNTER_A,1)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
    expect(script).toContain("return bc and c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
    expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
    expect(script).toContain("e5:SetCode(EFFECT_SPSUMMON_COST)");
    expect(script).toContain("Duel.GetActivityCount(tp,ACTIVITY_NORMALSUMMON)==0");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SUMMON)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_MSET)");
  });
});
