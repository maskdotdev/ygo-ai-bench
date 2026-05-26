import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-corruption-cell-a-counter.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c2561846.lua");

describe("Lua real Corruption Cell A restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const corruptionCellCode = "2561846"');
    expect(fixture).toContain("restores targeted activation into one A-Counter on an opponent face-up monster");
    expect(fixture).toContain("expect(restoredOpen.session.state.chain).toEqual([])");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterA)).toBe(1)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredOpen.session, decoy.uid), counterA)).toBe(0)");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("eventName: \"sentToGraveyard\"");

    expect(script).toContain('--Corruption Cell "A"');
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  });
});
