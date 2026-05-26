import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const aeropixCode = "83094004";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aeropixCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Aeropixthree restore coverage", () => {
  it("owns the zone-paired quick effect counter and stat fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-aeropixthree-counter-zone-stat.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${aeropixCode}.lua`), "utf8");

    expect(fixture).toContain("restores target-paired zone movement into counter placement and ATK/DEF reduction");
    expect(fixture).toContain(`const aeropixCode = "${aeropixCode}"`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("s.counter_place_list={0x1207}");
    expect(script).toContain("local g=e:GetHandler():GetColumnGroup()");
    expect(script).toContain("Duel.SelectTarget(tp,s.seqfilter,tp,0,LOCATION_MZONE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectDisableField(tp,1,LOCATION_MZONE,0,0xffffff&(~zone))");
    expect(script).toContain("Duel.MoveSequence(c,math.log(selzone,2))");
    expect(script).toContain("Duel.MoveSequence(tc,4-math.log(selzone,2))");
    expect(script).toContain("tc:AddCounter(0x1207,1)");
    expect(script).toContain("return c:GetCounter(0x1207)*-200");
    expect(fixture).toContain("currentDefense(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1000)");
  });
});
