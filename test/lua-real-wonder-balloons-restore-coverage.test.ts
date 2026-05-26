import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = path.resolve("test/lua-real-script-wonder-balloons-discard-counter-stat.test.ts");
const scriptPath = path.resolve(".upstream/ignis/script/official/c78574395.lua");

describe("Lua real Wonder Balloons restore coverage", () => {
  it("keeps the fixture anchored to the real script behaviors it covers", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(fixture).toContain("Wonder Balloons");
    expect(fixture).toContain("restores hand discard cost into Balloon Counters and opponent ATK loss");
    expect(fixture).toContain("getDuelCardCounter(findCard(restored.session, balloons.uid), counterBalloon)");
    expect(fixture).toContain("currentAttack(findCard(restored.session, opponentMonster.uid), restored.session.state)");
    expect(fixture).toContain("reason: duelReason.cost");

    expect(script).toContain("c:EnableCounterPermit(0x32)");
    expect(script).toContain("s.counter_place_list={0x32}");
    expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,nil)");
    expect(script).toContain("local ct=Duel.DiscardHand(tp,Card.IsAbleToGraveAsCost,1,60,REASON_COST)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),0,0x32)");
    expect(script).toContain("c:AddCounter(0x32,e:GetLabel())");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetTargetRange(0,LOCATION_MZONE)");
    expect(script).toContain("return e:GetHandler():GetCounter(0x32)*-300");
  });
});
