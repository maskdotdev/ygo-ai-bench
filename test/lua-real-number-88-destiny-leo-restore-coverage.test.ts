import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-number-88-destiny-leo-counter-win.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c48995978.lua");

describe("Lua real Number 88 Destiny Leo restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const leoCode = "48995978"');
    expect(fixture).toContain("restores Destiny Counter ignition cost, Battle Phase lock, and chain-solving win metadata");
    expect(fixture).toContain("getDuelCardCounter(restoredWinReady.session.state.cards.find((card) => card.uid === leo.uid), counterDestiny)).toBe(3)");
    expect(fixture).toContain("effectCannotBattlePhase");
    expect(fixture).toContain("eventChainSolving");

    expect(script).toContain("--Number 88: Gimmick Puppet of Leo");
    expect(script).toContain("c:EnableCounterPermit(0x2b)");
    expect(script).toContain("Xyz.AddProcedure(c,nil,8,3)");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("return Duel.GetFieldGroupCount(tp,LOCATION_STZONE,0)==0");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)>0");
    expect(script).toContain("c:AddCounter(0x2b,1)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("if c:GetCounter(0x2b)==3 then");
    expect(script).toContain("Duel.Win(tp,WIN_REASON_PUPPET_LEO)");
  });
});
