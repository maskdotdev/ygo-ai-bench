import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const alienWarriorCode = "98719226";
const hasUpstreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienWarriorCode}.lua`));

describe.skipIf(!hasUpstreamScript)("Lua real script Alien Warrior restore coverage", () => {
  it("owns the battle-destroyed A-Counter placement and Alien battle stat fixture", () => {
    const fixture = fs.readFileSync(path.resolve("test/lua-real-script-alien-warrior-counter-battle-stat.test.ts"), "utf8");
    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${alienWarriorCode}.lua`), "utf8");

    expect(fixture).toContain("restores battle-destroyed A-Counter placement and Alien battle stat loss");
    expect(fixture).toContain(`const alienWarriorCode = "${alienWarriorCode}"`);
    expect(script).toContain("s.counter_place_list={COUNTER_A}");
    expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
    expect(script).toContain("local tc=e:GetHandler():GetReasonCard()");
    expect(script).toContain("tc:AddCounter(COUNTER_A,2)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
    expect(script).toContain("c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
    expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
    expect(fixture).toContain("effectId: \"lua-1-1140\"");
    expect(fixture).toContain("currentAttack(findCard(statOpen.session, statAttacker.uid), statOpen.session.state)).toBe(1900)");
  });
});
