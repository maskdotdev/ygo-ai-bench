import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-eternal-dread-clock-counter.test.ts");
const eternalDreadPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c35787450.lua");
const clockTowerPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c75041269.lua");

describe("Lua real Eternal Dread restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const eternalDreadScript = fs.readFileSync(eternalDreadPath, "utf8");
    const clockTowerScript = fs.readFileSync(clockTowerPath, "utf8");

    expect(fixture).toContain('const eternalDreadCode = "35787450"');
    expect(fixture).toContain('const clockTowerCode = "75041269"');
    expect(fixture).toContain("restores Field Zone lookup adding two Clock Counters to each face-up Clock Tower Prison");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, ownClockTower.uid), clockCounter)).toBe(2)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, opponentClockTower.uid), clockCounter)).toBe(2)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, decoyField.uid), clockCounter)).toBe(0)");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("eventName: \"sentToGraveyard\"");

    expect(eternalDreadScript).toContain("--Eternal Dread");
    expect(eternalDreadScript).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(eternalDreadScript).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(eternalDreadScript).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(eternalDreadScript).toContain("Duel.GetFieldCard(tp,LOCATION_FZONE,0)");
    expect(eternalDreadScript).toContain("return tc and tc:IsFaceup() and tc:IsCode(75041269)");
    expect(eternalDreadScript).toContain("Duel.GetFieldCard(1-tp,LOCATION_FZONE,0)");
    expect(eternalDreadScript).toContain("tc:AddCounter(0x1b,2)");
    expect(clockTowerScript).toContain("c:EnableCounterPermit(0x1b)");
  });
});
