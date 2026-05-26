import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-card-guard-counter-replace-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c4694209.lua");

describe("Lua real Card Guard restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const cardGuardCode = "4694209"');
    expect(fixture).toContain("restores summon Guard Counter placement, ATK scaling, and ignition-granted destroy replacement");
    expect(fixture).toContain("normalSummon");
    expect(fixture).toContain("activateTrigger");
    expect(fixture).toContain('effectId === "lua-4"');
    expect(fixture).toContain("destroyDuelCard(restoredIgnition.session.state, ally.uid");
    expect(fixture).toContain("currentAttack(findCard(restoredSummon.session, cardGuard.uid), restoredSummon.session.state)).toBe(1900)");

    expect(script).toContain("--Card Guard");
    expect(script).toContain("s.counter_place_list={0x1021}");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x1021)");
    expect(script).toContain("e:GetHandler():AddCounter(0x1021+COUNTER_NEED_ENABLE,1)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return c:GetCounter(0x1021)*300");
    expect(script).toContain("e4:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,0,1,1,e:GetHandler())");
    expect(script).toContain("c:RemoveCounter(tp,0x1021,1,REASON_EFFECT)");
    expect(script).toContain("tc:AddCounter(0x1021,1)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("return not e:GetHandler():IsReason(REASON_REPLACE+REASON_RULE) and e:GetHandler():GetCounter(0x1021)>0");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1021,1,REASON_EFFECT)");
  });
});
