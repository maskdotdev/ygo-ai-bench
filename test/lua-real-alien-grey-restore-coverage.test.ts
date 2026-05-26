import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Alien Grey restore coverage", () => {
  it("owns flip A-Counter placement, flip-flag draw, and A-Counter battle stat loss", () => {
    const file = "test/lua-real-script-alien-grey-flip-counter-draw-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text).toContain("restoreDuelWithLuaScripts");
    expect(text).toContain("restoreComplete");
    expect(text).toContain('incompleteReasons.join("; ")');
    expect(text).toContain("missingRegistryKeys).toEqual([])");
    expect(text).toContain("missingChainLimitRegistryKeys).toEqual([])");
    expect(text).toContain("getLuaRestoreLegalActions");
    expect(text).toContain("getLuaRestoreLegalActionGroups");
    expect(text).toContain("getGroupedDuelLegalActions");
    expect(text).toContain("flatMap((group) => group.actions)");

    const required = [
      'const alienGreyCode = "62437709"',
      "Alien Grey",
      "restores flip A-Counter placement, flip-flag battle-destroyed draw, and battle target stat loss",
      "s.counter_place_list={COUNTER_A}",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "tc:AddCounter(COUNTER_A,1)",
      "e2:SetCode(EVENT_FLIP)",
      "RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD_EXC_GRAVE,0,0)",
      "e3:SetCategory(CATEGORY_DRAW)",
      "e3:SetCode(EVENT_BATTLE_DESTROYED)",
      "e:GetHandler():GetFlagEffect(id)~=0",
      "Duel.SetTargetParam(1)",
      "Duel.Draw(p,d,REASON_EFFECT)",
      "return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()",
      "c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)",
      "return c:GetCounter(COUNTER_A)*-300",
      'eventName: "flipSummoned"',
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
      'eventName: "battleDestroyed"',
      'eventName: "cardsDrawn"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
