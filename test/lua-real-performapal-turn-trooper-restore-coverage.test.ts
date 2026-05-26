import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lua real script Performapal Turn Trooper restore coverage", () => {
  it("documents the counter, attack negation, and temporary banish fixture", () => {
    const file = "test/lua-real-script-performapal-turn-trooper-counter-remove.test.ts";
    const source = fs.readFileSync(file, "utf8");

    expect(source).toContain('const turnTrooperCode = "220414"');
    expect(source).toContain("restores battle-start counters, one-counter attack negation, and two-counter self-tribute temporary banish");
    expect(source).toContain("c:EnableCounterPermit(0x14a)");
    expect(source).toContain("c:SetCounterLimit(0x14a,2)");
    expect(source).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
    expect(source).toContain("c:AddCounter(0x14a,1)");
    expect(source).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(source).toContain("Duel.NegateAttack()");
    expect(source).toContain("e3:SetCategory(CATEGORY_REMOVE)");
    expect(source).toContain("e3:SetCost(Cost.SelfTribute)");
    expect(source).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,tp,LOCATION_MZONE)");
    expect(source).toContain("aux.RemoveUntil(g,nil,REASON_EFFECT,PHASE_END,id,e,tp,aux.DefaultFieldReturnOp");
    expect(source).toContain('eventName: "counterAdded"');
    expect(source).toContain('eventName: "attackDisabled"');
    expect(source).toContain('eventName: "banished"');
    expect(source).toContain("expectRestoredLegalActions(restoredBattleStart, 0)");
    expect(source).toContain("expectRestoredLegalActions(restoredRemove, 0)");
  });
});
