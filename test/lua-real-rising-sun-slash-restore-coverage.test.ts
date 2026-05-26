import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-rising-sun-slash-counter-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c94807487.lua");

describe("Lua real Rising Sun Slash restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const slashCode = "94807487"');
    expect(fixture).toContain("restores equipped counter-scaling ATK and overlay-remove replacement metadata");
    expect(fixture).toContain("getDuelCardCounter(findCard(restored.session, slash.uid), counterRisingSun)).toBe(2)");
    expect(fixture).toContain("currentAttack(findCard(restored.session, utopia.uid), restored.session.state)).toBe(3500)");
    expect(fixture).toContain("effectOverlayRemoveReplace");
    expect(fixture).toContain("eventAttackDisabled");

    expect(script).toContain("--Rising Sun Slash");
    expect(script).toContain("c:EnableCounterPermit(0x31)");
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_UTOPIA))");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e4:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e4:SetCode(EVENT_ATTACK_DISABLED)");
    expect(script).toContain("e:GetHandler():AddCounter(0x31,1)");
    expect(script).toContain("e5:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return e:GetHandler():GetCounter(0x31)*500");
    expect(script).toContain("e6:SetCode(EFFECT_OVERLAY_REMOVE_REPLACE)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");
  });
});
