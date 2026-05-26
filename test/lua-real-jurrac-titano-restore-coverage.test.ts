import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const jurracTitanoKindCounts = { banishCostProtectionStatRestore: 1 } satisfies Record<JurracTitanoKind, number>;
type JurracTitanoKind = "banishCostProtectionStatRestore";

describe("Lua real Jurrac Titano restore coverage", () => {
  it("keeps Jurrac Titano's protection and banish-cost stat path owned", () => {
    const file = "test/lua-real-script-jurrac-titano-banish-protect-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
    expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
    for (const snippet of [
      'const titanoCode = "85028288"',
      "Jurrac Titano",
      "restores special-summon condition, Trap-monster targeting protection, and banish-cost ATK gain",
      "e1:SetCode(EFFECT_SPSUMMON_CONDITION)",
      "e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
      "return re:GetHandler():IsType(TYPE_TRAP+TYPE_MONSTER)",
      "return c:IsAttackBelow(1700) and c:IsSetCard(SET_JURRAC) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)",
      "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(1000)",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)",
      "code: effectSpecialSummonCondition",
      "code: effectCannotBeEffectTarget",
      "reasonEffectId: 3",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === titano.uid), restored.session.state)).toBe(4000)",
      "code: effectUpdateAttack",
      "value: 1000",
      'eventName === "banished"',
      "eventReasonEffectId: 3",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Jurrac Titano fixture kind explicit", () => {
    expect(jurracTitanoKindCounts).toEqual({ banishCostProtectionStatRestore: 1 });
  });
});
