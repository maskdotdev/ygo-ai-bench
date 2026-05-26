import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const pumprincessCode = "17601919";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pumprincessCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Pumprincess restore coverage", () => {
  it("owns the destroyed-monster continuous spell redirect and standby counter stat fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-pumprincess-redirect-counter-stat.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${pumprincessCode}.lua`), "utf8");

    expect(fixture).toContain("restores destroyed monster to continuous spell redirect, standby counters, and opponent stat loss");
    expect(fixture).toContain(`const pumprincessCode = "${pumprincessCode}"`);
    expect(script).toContain("c:EnableCounterPermit(0x2f,LOCATION_SZONE)");
    expect(script).toContain("e1:SetCode(EFFECT_TO_GRAVE_REDIRECT_CB)");
    expect(script).toContain("return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:IsReason(REASON_DESTROY)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_TYPE)");
    expect(script).toContain("e1:SetValue(TYPE_SPELL+TYPE_CONTINUOUS)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x2f)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("return e:GetHandler():GetCounter(0x2f)*-100");
    expect(fixture).toContain("effectId: \"lua-4-4098\"");
    expect(fixture).toContain("currentAttack(findCard(finalRestore.session, opponent.uid), finalRestore.session.state)).toBe(1600)");
  });
});
