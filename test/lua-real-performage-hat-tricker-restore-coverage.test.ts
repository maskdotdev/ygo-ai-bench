import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-performage-hat-tricker-counter-damage-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c31292357.lua");

describe("Lua real Performage Hat Tricker restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const hatCode = "31292357"');
    expect(fixture).toContain("restores its two-monster hand Special Summon procedure");
    expect(fixture).toContain("restores damage-chain counter placement into final ATK and DEF at three counters");
    expect(fixture).toContain("currentAttack(restoredHat, restoredChain.session.state)).toBe(3300)");
    expect(fixture).toContain("currentDefense(restoredHat, restoredChain.session.state)).toBe(3300)");
    expect(fixture).toContain("effectChangeDamage");

    expect(script).toContain("--Performage Hat Tricker");
    expect(script).toContain("c:EnableCounterPermit(0x36)");
    expect(script).toContain("c:SetCounterLimit(0x36,3)");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,LOCATION_MZONE)>=2");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e2:SetCondition(aux.damcon1)");
    expect(script).toContain("c:AddCounter(0x36,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_DAMAGE)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)");
    expect(script).toContain("e3:SetCode(EVENT_ADD_COUNTER+0x36)");
    expect(script).toContain("return e:GetHandler():GetCounter(0x36)==3");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  });
});
