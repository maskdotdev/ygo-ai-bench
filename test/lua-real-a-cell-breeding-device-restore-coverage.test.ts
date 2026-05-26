import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-a-cell-breeding-device-standby-counter.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c34541863.lua");

describe("Lua real A Cell Breeding Device restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const breedingDeviceCode = "34541863"');
    expect(fixture).toContain("restores its turn-player Standby target trigger and places an A-Counter");
    expect(fixture).toContain("action.type === \"changePhase\" && action.phase === \"standby\"");
    expect(fixture).toContain("action.type === \"activateTrigger\" && action.uid === device.uid");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, target.uid), counterA)).toBe(1)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, decoy.uid), counterA)).toBe(0)");

    expect(script).toContain('--"A" Cell Breeding Device');
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return Duel.IsTurnPlayer(tp)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  });
});
