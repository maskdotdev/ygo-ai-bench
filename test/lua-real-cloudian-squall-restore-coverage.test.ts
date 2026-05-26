import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-cloudian-squall-standby-counter.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c90135989.lua");

describe("Lua real Cloudian Squall restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const squallCode = "90135989"');
    expect(fixture).toContain("restores turn-player Standby trigger adding Fog Counters to all face-up monsters");
    expect(fixture).toContain("action.type === \"changePhase\" && action.phase === \"standby\"");
    expect(fixture).toContain("action.type === \"activateTrigger\" && action.uid === squall.uid");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, playerMonster.uid), counterFog)).toBe(1)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, opponentMonster.uid), counterFog)).toBe(1)");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, faceDownMonster.uid), counterFog)).toBe(0)");

    expect(script).toContain("--Cloudian Squall");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("return Duel.IsTurnPlayer(tp)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("for tc in g:Iter() do");
    expect(script).toContain("tc:AddCounter(COUNTER_FOG,1)");
  });
});
