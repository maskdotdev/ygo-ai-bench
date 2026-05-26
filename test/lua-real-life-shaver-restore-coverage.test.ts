import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lua real script Life Shaver restore coverage", () => {
  it("documents the counter End Phase trigger and counter-count discard fixture", () => {
    const file = "test/lua-real-script-life-shaver-counter-hand-discard.test.ts";
    const source = fs.readFileSync(file, "utf8");

    expect(source).toContain('const lifeShaverCode = "38105306"');
    expect(source).toContain("restores opponent End Phase counters into self-send exact-count hand discard");
    expect(source).toContain("c:EnableCounterPermit(0x208)");
    expect(source).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(source).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(source).toContain("return Duel.IsTurnPlayer(1-tp)");
    expect(source).toContain("c:AddCounter(0x208,1)");
    expect(source).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_HANDES)");
    expect(source).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,1-tp,c:GetCounter(0x208))");
    expect(source).toContain("Duel.SendtoGrave(c,REASON_EFFECT)>0");
    expect(source).toContain("Duel.DiscardHand(1-tp,Card.IsDiscardable,ct,ct,REASON_EFFECT,nil,REASON_EFFECT)");
    expect(source).toContain('eventName: "counterAdded"');
    expect(source).toContain('eventName: "sentToGraveyard"');
    expect(source).toContain("expectRestoredLegalActions(restoredEndPhase, 0)");
    expect(source).toContain("expectRestoredLegalActions(restoredDiscard, 0)");
  });
});
