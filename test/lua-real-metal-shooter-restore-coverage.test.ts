import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const fixturePath = path.resolve("test/lua-real-script-metal-shooter-counter-replace-stat.test.ts");
const scriptPath = path.join(upstreamRoot, "script", "official", "c7200041.lua");

describe("Lua real Metal Shooter restore coverage", () => {
  it("anchors the real-script counter, stat, and effect replacement fixture", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("restoreDuelWithLuaScripts");
    expect(fixture).toContain("expectRestoredLegalActions");
    expect(fixture).toContain("getDuelCardCounter");
    expect(fixture).toContain("currentAttack");
    expect(fixture).toContain("destroyDuelCard(restoredReplacement.session.state, shooter.uid");
    expect(fixture).toContain("duelReason.effect | duelReason.destroy");
    expect(fixture).toContain("duelReason.battle | duelReason.destroy");
    expect(fixture).toContain("eventName: \"counterRemoved\"");
    expect(script).toContain("--Metal Shooter");
    expect(script).toContain("c:EnableCounterPermit(0x26)");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x26)");
    expect(script).toContain("e:GetHandler():AddCounter(0x26,2)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return c:GetCounter(0x26)*800");
    expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("c:IsReason(REASON_EFFECT)");
    expect(script).toContain("c:RemoveCounter(tp,0x26,1,REASON_EFFECT)");
  });
});
