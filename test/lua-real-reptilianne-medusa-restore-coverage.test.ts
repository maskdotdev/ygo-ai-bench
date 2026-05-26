import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const reptilianneMedusaKindCounts = { handCostZeroPositionLockRestore: 1 } satisfies Record<ReptilianneMedusaKind, number>;
type ReptilianneMedusaKind = "handCostZeroPositionLockRestore";

describe("Lua real Reptilianne Medusa restore coverage", () => {
  it("keeps Reptilianne Medusa's hand-cost zero and position lock owned", () => {
    const file = "test/lua-real-script-reptilianne-medusa-cost-zero-position-lock.test.ts";
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
      'const medusaCode = "89810518"',
      "Reptilianne Medusa",
      "restores hand-to-Grave cost into opponent ATK zero and position-change lock",
      "Duel.IsExistingMatchingCard(Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,nil)",
      "Duel.SelectMatchingCard(tp,Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,1,nil)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(0)",
      "e2:SetDescription(3313)",
      "e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(0)",
      "code: effectSetAttackFinal",
      "code: effectCannotChangePosition",
      'eventName === "sentToGraveyard"',
      'eventName === "becameTarget"',
      "relatedEffectId: 1",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Reptilianne Medusa fixture kind explicit", () => {
    expect(reptilianneMedusaKindCounts).toEqual({ handCostZeroPositionLockRestore: 1 });
  });
});
