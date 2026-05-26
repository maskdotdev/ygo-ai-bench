import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-predaplant-dragostapelia-counter-level-negate.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c69946549.lua");

describe("Lua real Predaplant Dragostapelia restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const dragostapeliaCode = "69946549"');
    expect(fixture).toContain("restores targeted Predator Counter placement, Level 1 lock, and chain-solving negate metadata");
    expect(fixture).toContain("currentLevel(restoredTarget, restored.session.state)).toBe(1)");
    expect(fixture).toContain("eventChainSolving");
    expect(fixture).toContain("effectChangeLevel");

    expect(script).toContain("--Predaplant Dragostapelia");
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_FUSION),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK))");
    expect(script).toContain("s.counter_place_list={COUNTER_PREDATOR}");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("re:IsMonsterEffect() and re:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
    expect(script).toContain("Duel.NegateEffect(ev)");
  });
});
