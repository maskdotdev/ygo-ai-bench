import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-pitch-black-power-stone-counter-transfer.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c34029630.lua");

describe("Lua real Pitch-Black Power Stone restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const powerStoneCode = "34029630"');
    expect(fixture).toContain("restores face-up Spell Counter quick transfer into zero-counter self-destroy");
    expect(fixture).toContain("action.effectId === \"lua-3-1002\"");
    expect(fixture).toContain("expect(addDuelCardCounter(powerStone, counterSpell, 1)).toBe(true)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, powerStone.uid), counterSpell)).toBe(0)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterSpell)).toBe(1)");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("eventName: \"destroyed\"");

    expect(script).toContain("--Pitch-Black Power Stone");
    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("Duel.IsCanAddCounter(tp,COUNTER_SPELL,3,c)");
    expect(script).toContain("c:AddCounter(COUNTER_SPELL,3)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,94)");
    expect(script).toContain("e:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
    expect(script).toContain("c:RegisterFlagEffect(0,RESET_CHAIN,EFFECT_FLAG_CLIENT_HINT,1,0,65)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e4:SetCode(EFFECT_SELF_DESTROY)");
    expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
  });
});
