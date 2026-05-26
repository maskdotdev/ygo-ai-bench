import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua real script Ursarctic Radiation restore coverage", () => {
  it("owns the special-summon draw and End Phase shuffle fixture shape", () => {
    const file = "test/lua-real-script-ursarctic-radiation-counter-draw-todeck.test.ts";
    const source = fs.readFileSync(path.resolve(file), "utf8");

    expect(source).toContain("Lua real script Ursarctic Radiation counter draw toDeck");
    expect(source).toContain("restores special-summon counter-cost draw and End Phase Ursarctic shuffle");
    expect(source).toContain('const radiationCode = "32692693"');
    expect(source).toContain("c:EnableCounterPermit(0x209)");
    expect(source).toContain("c:AddCounter(0x209,7)");
    expect(source).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(source).toContain("c:IsSummonLocation(LOCATION_HAND|LOCATION_EXTRA)");
    expect(source).toContain("e:GetHandler():RemoveCounter(tp,0x209,1,REASON_COST)");
    expect(source).toContain("Duel.SetTargetPlayer(tp)");
    expect(source).toContain("Duel.SetTargetParam(1)");
    expect(source).toContain("Duel.Draw(p,d,REASON_EFFECT)");
    expect(source).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(source).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(source).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  });
});
