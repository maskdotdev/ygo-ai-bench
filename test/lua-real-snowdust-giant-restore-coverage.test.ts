import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const snowdustCode = "73659078";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${snowdustCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Snowdust Giant restore coverage", () => {
  it("owns the detach-cost reveal flow, Ice Counter placement, and field ATK reduction fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-snowdust-giant-counter-stat.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${snowdustCode}.lua`), "utf8");

    expect(fixture).toContain("restores detach-cost Ice Counter placement into global non-WATER ATK reduction");
    expect(fixture).toContain(`const snowdustCode = "${snowdustCode}"`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),4,2)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_HAND,0,nil)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,rg)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("tc:AddCounter(0x1015,1)");
    expect(script).toContain("return Duel.GetCounter(0,1,1,0x1015)*-200");
    expect(fixture).toContain("reasonEffectId: 2");
    expect(fixture).toContain("currentAttack(restoredStat.session.state.cards.find((card) => card.uid === nonWaterTarget.uid), restoredStat.session.state)).toBe(1400)");
  });
});
