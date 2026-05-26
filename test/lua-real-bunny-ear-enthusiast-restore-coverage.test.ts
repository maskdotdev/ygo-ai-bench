import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua real script Bunny Ear Enthusiast restore coverage", () => {
  it("owns the counter-targeted temporary banish return fixture shape", () => {
    const file = "test/lua-real-script-bunny-ear-enthusiast-counter-remove.test.ts";
    const source = fs.readFileSync(path.resolve(file), "utf8");

    expect(source).toContain("Lua real script Bunny Ear Enthusiast counter remove");
    expect(source).toContain("restores counter-targeted temporary banish and next-standby field return");
    expect(source).toContain('const bunnyCode = "39643167"');
    expect(source).toContain("s.counter_place_list={0x1208}");
    expect(source).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(source).toContain("rc:AddCounter(0x1208,1)");
    expect(source).toContain("e2:SetCategory(CATEGORY_REMOVE)");
    expect(source).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
    expect(source).toContain("local reset_count=Duel.GetCurrentPhase()<=PHASE_STANDBY and 2 or 1");
    expect(source).toContain("aux.RemoveUntil(rg,nil,REASON_EFFECT,PHASE_STANDBY,id+100,e,tp,aux.DefaultFieldReturnOp");
    expect(source).toContain("function() return Duel.GetTurnCount()==turn_chk+1 end");
    expect(source).toContain("reasonEffectId: 3");
  });
});
