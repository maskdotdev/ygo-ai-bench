import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lua real script Dark Red Enchanter restore coverage", () => {
  it("documents the chain counter registration and counter-cost discard fixture", () => {
    const file = "test/lua-real-script-dark-red-enchanter-chain-counter-discard.test.ts";
    const source = fs.readFileSync(file, "utf8");

    expect(source).toContain('const enchanterCode = "45462639"');
    expect(source).toContain("restores summon counters, chain-solved Spell counter gain, ATK scaling, and counter-cost discard");
    expect(source).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(source).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(source).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,2,0,COUNTER_SPELL)");
    expect(source).toContain("e0:SetCode(EVENT_CHAINING)");
    expect(source).toContain("e0:SetOperation(aux.chainreg)");
    expect(source).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
    expect(source).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect() and e:GetHandler():GetFlagEffect(1)>0");
    expect(source).toContain("return c:GetCounter(COUNTER_SPELL)*300");
    expect(source).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)");
    expect(source).toContain("Duel.SendtoGrave(sg,REASON_DISCARD|REASON_EFFECT)");
    expect(source).toContain('eventName: "counterAdded"');
    expect(source).toContain('eventName: "counterRemoved"');
    expect(source).toContain('eventName: "sentToGraveyard"');
    expect(source).toContain("expectRestoredLegalActions(restoredSummon, 0)");
    expect(source).toContain("expectRestoredLegalActions(restoredDiscard, 0)");
  });
});
