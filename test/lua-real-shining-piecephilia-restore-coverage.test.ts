import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua real script Shining Piecephilia restore coverage", () => {
  it("owns the damage-step-end counter into optional decktop confirmation fixture shape", () => {
    const file = "test/lua-real-script-shining-piecephilia-counter-decktop.test.ts";
    const source = fs.readFileSync(path.resolve(file), "utf8");

    expect(source).toContain("Lua real script Shining Piecephilia counter decktop");
    expect(source).toContain("restores damage-step-end counter gain into optional monster decktop confirmation");
    expect(source).toContain('const piecephiliaCode = "49776811"');
    expect(source).toContain("c:EnableCounterPermit(0x20a)");
    expect(source).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(source).toContain("e2:SetCategory(CATEGORY_COUNTER+CATEGORY_DRAW+CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(source).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(source).toContain("c:IsStatus(STATUS_OPPO_BATTLE)");
    expect(source).toContain("c:AddCounter(0x20a,1)");
    expect(source).toContain("Duel.SelectMatchingCard(tp,Card.IsMonster,tp,LOCATION_DECK,0,1,1,nil)");
    expect(source).toContain("Duel.ShuffleDeck(tp)");
    expect(source).toContain("Duel.MoveSequence(tc,0)");
    expect(source).toContain("Duel.ConfirmDecktop(tp,1)");
  });
});
