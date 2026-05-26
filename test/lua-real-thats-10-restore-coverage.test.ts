import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-thats-10-counter-set.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c97223101.lua");

describe("Lua real That's 10 restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const thats10Code = "97223101"');
    expect(fixture).toContain("restores chain Access Counter gain into ATK boost and 10-counter self-return Trap Monster set");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredCounter.session, thats10.uid), counterAccess)).toBe(10)");
    expect(fixture).toContain("currentAttack(findCard(restoredCounter.session, monster.uid), restoredCounter.session.state)).toBe(2000)");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("EFFECT_TRAP_ACT_IN_SET_TURN");

    expect(script).toContain("c:EnableCounterPermit(COUNTER_ACCESS,LOCATION_STZONE)");
    expect(script).toContain("c:SetCounterLimit(COUNTER_ACCESS,10)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_CODE,CHAININFO_TRIGGERING_CODE2)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_ACCESS)");
    expect(script).toContain("c:AddCounter(COUNTER_ACCESS,1)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_ACCESS)*100");
    expect(script).toContain("e3:SetCode(EVENT_ADD_COUNTER+COUNTER_ACCESS)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_ACCESS)==10");
    expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)>0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil,false)");
    expect(script).toContain("Duel.SSet(tp,sc)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)");
  });
});
