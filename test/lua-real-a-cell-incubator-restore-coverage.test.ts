import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-a-cell-incubator-counter-redistribute.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c64163367.lua");

describe("Lua real A Cell Incubator restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const incubatorCode = "64163367"');
    expect(fixture).toContain("restores A-Counter remove tracking and destroyed Incubator counter redistribution");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, incubator.uid), counterA)).toBe(1)");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("eventName: \"leftField\"");
    expect(fixture).toContain("eventName: \"destroyed\"");

    expect(script).toContain("e2:SetCode(EVENT_REMOVE_COUNTER+COUNTER_A)");
    expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_A,1)");
    expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("local ct=e:GetHandler():GetCounter(COUNTER_A)");
    expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("e4:SetLabelObject(e3)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
  });
});
