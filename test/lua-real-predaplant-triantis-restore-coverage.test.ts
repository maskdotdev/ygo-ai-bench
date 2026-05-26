import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const triantisCode = "17825378";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${triantisCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Predaplant Triantis restore coverage", () => {
  it("owns the Pendulum Zone extra Fusion material and Predator Counter Level fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-predaplant-triantis-pzone-fusion-counter-level.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${triantisCode}.lua`), "utf8");

    expect(fixture).toContain("restores Pendulum Zone extra Fusion material and material-trigger Predator Counter Level 1 changes");
    expect(fixture).toContain(`const triantisCode = "${triantisCode}"`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_FUSION_MATERIAL)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_PZONE,0)");
    expect(script).toContain("e1:SetValue(function(_,c) return c and c:IsAttribute(ATTRIBUTE_DARK) end)");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("(r&REASON_FUSION)==REASON_FUSION and c:IsFaceup()");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,LOCATION_MZONE,1,max,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
    expect(fixture).toContain("effectId: \"lua-4-1108\"");
    expect(fixture).toContain("currentLevel(findCard(finalRestore.session, targetA.uid), finalRestore.session.state)).toBe(1)");
  });
});
