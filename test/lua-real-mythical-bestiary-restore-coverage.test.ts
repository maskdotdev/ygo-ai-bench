import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "test", "lua-real-script-mythical-bestiary-destroyed-summon-counter.test.ts");
const scriptPath = path.join(repoRoot, ".upstream", "ignis", "script", "official", "c38325384.lua");

describe("Lua real Mythical Bestiary restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain('const bestiaryCode = "38325384"');
    expect(fixture).toContain("Mythical Bestiary");
    expect(fixture).toContain("restores opponent-effect destruction, deck summon, SelectOption, and Spell Counter placement");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredTrigger.session, deckTarget.uid), counterSpell)).toBe(2)");
    expect(fixture).toContain("eventName: \"destroyed\"");
    expect(fixture).toContain("eventName: \"sentToGraveyard\"");
    expect(fixture).toContain("eventName: \"specialSummoned\"");
    expect(fixture).toContain("eventName: \"counterAdded\"");

    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.IsPlayerCanDiscardDeckAsCost(tp,2)");
    expect(script).toContain("Duel.DiscardDeck(tp,2,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
    expect(script).toContain("tc:AddCounter(COUNTER_SPELL,scn+1)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("return rp~=tp and c:IsReason(REASON_EFFECT) and c:IsPreviousControler(tp)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp):GetFirst()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)~=0");
  });
});
