import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-g-golem-crystal-heart-linked-counter-stat.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c61668670.lua");

describe("Lua real G Golem Crystal Heart restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const crystalHeartCode = "61668670"');
    expect(fixture).toContain("G Golem Crystal Heart");
    expect(fixture).toContain("restores linked-zone grave summon, custom counter, and co-linked EARTH grants");
    expect(fixture).toContain("getDuelCardCounter(requireCard(restoredOpen.session, crystalHeartCode), crystalCounter)).toBe(1)");
    expect(fixture).toContain("currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === earthLink.uid), restoredOpen.session.state)).toBe(2400)");
    expect(fixture).toContain("effectExtraAttack");
    expect(fixture).toContain("effectPierce");
    expect(fixture).toContain("eventName: \"becameTarget\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");

    expect(script).toContain("c:EnableCounterPermit(0x20c)");
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_CYBERSE),2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("local zone=c:GetFreeLinkedZone()&ZONES_MMZ");
    expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp,zone)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp,zone)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP,zone)>0");
    expect(script).toContain("c:AddCounter(0x20c,1)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_EXTRA_ATTACK)");
    expect(script).toContain("e4:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("return e:GetHandler():GetMutualLinkedGroup():IsContains(c) and c:IsAttribute(ATTRIBUTE_EARTH)");
    expect(script).toContain("return e:GetHandler():GetCounter(0x20c)*600");
  });
});
