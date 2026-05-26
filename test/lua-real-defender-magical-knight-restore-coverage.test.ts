import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-defender-magical-knight-counter-replace.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c2525268.lua");

describe("Lua real Defender Magical Knight restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const defenderCode = "2525268"');
    expect(fixture).toContain("restores normal summon Spell Counter placement and counter-cost Spellcaster destroy replacement");
    expect(fixture).toContain("SelectEffectYesNo");
    expect(fixture).toContain("effectDestroyReplace");
    expect(fixture).toContain("effectDestroyReplace");
    expect(fixture).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,count,REASON_COST)");

    expect(script).toContain("--Defender, the Magical Knight");
    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("c:SetCounterLimit(COUNTER_SPELL,1)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
    expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("return count>0 and Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,count,REASON_COST)");
    expect(script).toContain("return Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
    expect(script).toContain("return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:IsRace(RACE_SPELLCASTER)");
    expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,count,REASON_COST)");
  });
});
