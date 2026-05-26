import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua real script On Your Mark restore coverage", () => {
  it("owns the optional Synchron search, Signal Counter, and draw discard fixture shape", () => {
    const file = "test/lua-real-script-on-your-mark-counter-draw-search.test.ts";
    const source = fs.readFileSync(path.resolve(file), "utf8");

    expect(source).toContain("Lua real script On Your Mark counter draw search");
    expect(source).toContain("restores optional Synchron search, Standby Signal Counter gain, and counter-cost draw discard");
    expect(source).toContain('const markCode = "31006879"');
    expect(source).toContain("s.listed_series={SET_SYNCHRON}");
    expect(source).toContain("s.counter_place_list={COUNTER_SIGNAL}");
    expect(source).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(source).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
    expect(source).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
    expect(source).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(source).toContain("e:GetHandler():AddCounter(COUNTER_SIGNAL,1)");
    expect(source).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SIGNAL,2,REASON_COST)");
    expect(source).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SIGNAL,2,REASON_COST)");
    expect(source).toContain("Duel.SendtoGrave(c,REASON_COST)");
    expect(source).toContain("Duel.Draw(p,d,REASON_EFFECT)");
    expect(source).toContain("Duel.ShuffleHand(p)");
    expect(source).toContain("Duel.DiscardHand(p,nil,1,1,REASON_EFFECT)");
  });
});
