import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-dragon-dwelling-deep-counter-leave-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c4404099.lua");

describe("Lua real Dragon Dwelling Deep restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const dragonCode = "4404099"');
    expect(fixture).toContain("restores standby counter metadata and leave-field counter snapshot trigger availability");
    expect(fixture).toContain("activateTrigger");
    expect(fixture).toContain("eventLeaveFieldP");
    expect(fixture).toContain("effect.code === 100");

    expect(script).toContain("--The Dragon Dwelling in the Deep");
    expect(script).toContain("c:EnableCounterPermit(0x23)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x23)");
    expect(script).toContain("e:GetHandler():AddCounter(0x23,1)");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e2:SetOperation(s.regop)");
    expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("local ct=e:GetHandler():GetCounter(0x23)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_FISH|RACE_SEASERPENT),tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(e:GetLabel()*200)");
  });
});
