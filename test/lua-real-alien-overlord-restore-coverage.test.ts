import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const fixturePath = path.resolve("test/lua-real-script-alien-overlord-counter-procedure-stat.test.ts");
const scriptPath = path.join(upstreamRoot, "script", "official", "c63253763.lua");

describe("Lua real Alien Overlord restore coverage", () => {
  it("anchors the real-script counter procedure and battle stat fixture", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("restoreDuelWithLuaScripts");
    expect(fixture).toContain("expectRestoredLegalActions");
    expect(fixture).toContain("specialSummonProcedure");
    expect(fixture).toContain("getDuelCardCounter");
    expect(fixture).toContain("counterRemoved");
    expect(fixture).toContain("currentAttack");
    expect(fixture).toContain("currentDefense");
    expect(script).toContain("--Alien Overlord");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.IsCanRemoveCounter(c:GetControler(),1,1,COUNTER_A,2,REASON_COST)");
    expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE_CAL)");
    expect(script).toContain("bc:IsSetCard(SET_ALIEN)");
  });
});
