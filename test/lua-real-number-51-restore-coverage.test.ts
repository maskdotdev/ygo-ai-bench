import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua real script Number 51 restore coverage", () => {
  it("owns the detach counter and three-counter battle phase destruction fixture shape", () => {
    const file = "test/lua-real-script-number-51-counter-destroy.test.ts";
    const source = fs.readFileSync(path.resolve(file), "utf8");

    expect(source).toContain("Lua real script Number 51 counter destroy");
    expect(source).toContain("restores damage-step-end detach counter gain and battle phase three-counter field destruction");
    expect(source).toContain('const finisherCode = "56292140"');
    expect(source).toContain("c:EnableCounterPermit(0x40)");
    expect(source).toContain("Xyz.AddProcedure(c,nil,3,3)");
    expect(source).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(source).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(source).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
    expect(source).toContain("e:GetHandler():AddCounter(0x40,1)");
    expect(source).toContain("e3:SetCode(EVENT_PHASE|PHASE_BATTLE)");
    expect(source).toContain("return e:GetHandler():GetBattledGroupCount()>0 and e:GetHandler():GetCounter(0x40)==3");
    expect(source).toContain("Duel.Destroy(g,REASON_EFFECT)");
  });
});
