import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const cyberneticMagicianKindCounts = { discardTargetFinalStatRestore: 1 } satisfies Record<CyberneticMagicianKind, number>;
type CyberneticMagicianKind = "discardTargetFinalStatRestore";

describe("Lua real Cybernetic Magician restore coverage", () => {
  it("keeps Cybernetic Magician's discard cost and target final-stat restore owned", () => {
    const file = "test/lua-real-script-cybernetic-magician-discard-target-final-stat.test.ts";
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
      'const magicianCode = "59023523"',
      "Cybernetic Magician",
      "restores discard cost and face-up target selection into final ATK 2000",
      "Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,e:GetHandler())",
      "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "Duel.GetFirstTarget()",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetValue(2000)",
      "reasonEffectId: 1",
      "eventReasonEffectId: 1",
      'eventName: "discarded"',
      "currentAttack(restored.session.state.cards.find((card) => card.uid === magician.uid), restored.session.state)).toBe(2000)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Cybernetic Magician fixture kind explicit", () => {
    expect(cyberneticMagicianKindCounts).toEqual({ discardTargetFinalStatRestore: 1 });
  });
});
