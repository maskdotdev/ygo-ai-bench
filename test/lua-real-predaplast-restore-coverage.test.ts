import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = path.resolve("test/lua-real-script-predaplast-counter-replace.test.ts");
const scriptPath = path.resolve(".upstream/ignis/script/official/c72129804.lua");

describe("Lua real Predaplast restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("Predaplast");
    expect(fixture).toContain("restores hand reveal target counters, Level 1 locks, and grave Predaplant battle destroy replacement");
    expect(fixture).toContain("getDuelCardCounter(findCard(restoredActivation.session, targetA.uid), counterPredator)");
    expect(fixture).toContain("currentLevel(findCard(restoredActivation.session, targetA.uid), restoredActivation.session.state)");
    expect(fixture).toContain("destroyDuelCard(restoredReplacement.session.state, ownPredaplant.uid");
    expect(fixture).toContain("SelectEffectYesNo");

    expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_HAND,0,e:GetHandler())");
    expect(script).toContain("Duel.GetTargetCount(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,#g,#g,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
    expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
  });
});
