import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-chaos-core-target-counter-replace.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c54040484.lua");

describe("Lua real Chaos Core restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const chaosCoreCode = "54040484"');
    expect(fixture).toContain("Chaos Core");
    expect(fixture).toContain("restores targeted SelectUnselectGroup sends into counters, damage prevention, and counter destruction replacement");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTargeted.session, chaosCore.uid), counterPhantasm)).toBe(1)");
    expect(fixture).toContain("effect.code === 201");
    expect(fixture).toContain("eventName: \"sentToGraveyard\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("battleDamageDealt");
    expect(fixture).toContain("SelectEffectYesNo");

    expect(script).toContain("c:EnableCounterPermit(0x202)");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_TOGRAVE)");
    expect(script).toContain("e1:SetCode(EVENT_BECOME_TARGET)");
    expect(script).toContain("e2:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("return c:IsCode(69890967,6007213,32491822) and c:IsAbleToGrave()");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,3,s.ctcheck,1,tp,HINTMSG_TOGRAVE)");
    expect(script).toContain("local oc=#(Duel.GetOperatedGroup())");
    expect(script).toContain("c:AddCounter(0x202,oc)");
    expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x202,1,REASON_EFFECT)");
  });
});
