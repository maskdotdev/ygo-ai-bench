import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-alien-shocktrooper-mframe-counter-revive.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c74974229.lua");

describe("Lua real Alien Shocktrooper M-Frame restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const mframeCode = "74974229"');
    expect(fixture).toContain("Alien Shocktrooper M-Frame");
    expect(fixture).toContain("restores discard-level A-Counter placement and destroyed M-Frame dncheck Reptile revival");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredCounters.session, mframe.uid), counterA)).toBe(4)");
    expect(fixture).toContain("eventName: \"discarded\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");

    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_REPTILE),2,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetOriginalLevel())");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("for i=1,e:GetLabel() do");
    expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.acfilter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ct,aux.dncheck,1,tp,HINTMSG_SPSUMMON)");
    expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
  });
});
