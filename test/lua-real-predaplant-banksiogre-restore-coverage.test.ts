import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const banksiogreCode = "22138839";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${banksiogreCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Predaplant Banksiogre restore coverage", () => {
  it("owns the opponent-counter release procedure and to-grave level change fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-predaplant-banksiogre-counter-procedure-level.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${banksiogreCode}.lua`), "utf8");

    expect(fixture).toContain("restores opponent Predator Counter release procedure and to-grave counter level changes");
    expect(fixture).toContain(`const banksiogreCode = "${banksiogreCode}"`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.CheckReleaseGroup(tp,s.rfilter,1,false,1,true,c,tp,nil,true,nil,tp)");
    expect(script).toContain("Duel.SelectReleaseGroup(tp,s.rfilter,1,1,false,true,true,c,nil,nil,true,nil,tp)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(fixture).toContain("effectId === \"lua-2-1014\"");
    expect(fixture).toContain("currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === levelFour.uid), restoredLevel.session.state)).toBe(1)");
  });
});
