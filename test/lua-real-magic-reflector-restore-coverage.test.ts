import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = path.resolve("test/lua-real-script-magic-reflector-counter-replace.test.ts");
const scriptPath = path.resolve(".upstream/ignis/script/official/c61844784.lua");

describe("Lua real Magic Reflector restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("Magic Reflector");
    expect(fixture).toContain("restores Guard Counter placement and target Spell destroy replacement");
    expect(fixture).toContain("getDuelCardCounter(findCard(restored.session, targetSpell.uid), counterGuard)");
    expect(fixture).toContain("destroyDuelCard(restored.session.state, targetSpell.uid");
    expect(fixture).toContain("counterRemoved");

    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_SZONE,0,1,e:GetHandler())");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_SZONE,0,1,1,e:GetHandler())");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:AddCounter(0x102a,1)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("e:GetHandler():GetCounter(0x102a)>0");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x102a,1,REASON_EFFECT)");
  });
});
