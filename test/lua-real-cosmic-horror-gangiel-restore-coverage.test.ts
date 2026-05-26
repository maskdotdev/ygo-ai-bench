import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const fixturePath = path.resolve("test/lua-real-script-cosmic-horror-gangiel-counter-battle-stat.test.ts");
const scriptPath = path.join(upstreamRoot, "script", "official", "c51192573.lua");

describe("Lua real Cosmic Horror Gangi'el restore coverage", () => {
  it("anchors the real-script counter and battle stat fixture", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("restoreDuelWithLuaScripts");
    expect(fixture).toContain("expectRestoredLegalActions");
    expect(fixture).toContain("getDuelCardCounter");
    expect(fixture).toContain("currentAttack");
    expect(fixture).toContain("currentDefense");
    expect(fixture).toContain("eventName: \"becameTarget\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(script).toContain("--Cosmic Horror Gangi'el");
    expect(script).toContain("aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE_CAL)");
    expect(script).toContain("local bc=c:GetBattleTarget()");
    expect(script).toContain("bc:IsSetCard(SET_ALIEN)");
    expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
  });
});
