import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-beat-cop-material-counter-replace.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c99011763.lua");

describe("Lua real Beat Cop restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const beatCopCode = "99011763"');
    expect(fixture).toContain("restores DARK distinct-code material check into counter ignition and destroy replacement");
    expect(fixture).toContain("linkSummon");
    expect(fixture).toContain('action.effectId === "lua-4"');
    expect(fixture).toContain("destroyDuelCard(restoredLink.session.state, protectedTarget.uid");
    expect(fixture).toContain("expect(counteredCards.map((card) => card.uid)).toEqual([protectedTarget.uid])");
    expect(fixture).toContain("c:EnableCounterPermit(0x1049,LOCATION_ONFIELD)");

    expect(script).toContain("--Beat Cop from the Underworld");
    expect(script).toContain("Link.AddProcedure(c,nil,2,2)");
    expect(script).toContain("e1:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("if #g==2 and g:GetClassCount(Card.GetCode)==#g and not g:IsExists(aux.NOT(Card.IsAttribute),1,nil,ATTRIBUTE_DARK) then");
    expect(script).toContain("s.counter_place_list={0x1049}");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetCountLimit(1,id)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("tc:AddCounter(0x1049,1)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("return not e:GetHandler():IsReason(REASON_REPLACE+REASON_RULE) and e:GetHandler():GetCounter(0x1049)>0");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1049,1,REASON_EFFECT)");
  });
});
