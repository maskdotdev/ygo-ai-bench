import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const seaKoalaKindCounts = { beastConditionZeroStatRestore: 1 } satisfies Record<SeaKoalaKind, number>;
type SeaKoalaKind = "beastConditionZeroStatRestore";

describe("Lua real Sea Koala restore coverage", () => {
  it("keeps Sea Koala's Beast-gated target zero-stat restore owned", () => {
    const file = "test/lua-real-script-sea-koala-beast-condition-zero-stat.test.ts";
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
      'const koalaCode = "87685879"',
      "Sea Koala",
      "restores Beast-gated targeting into opponent nonzero ATK set to 0",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_BEAST),tp,LOCATION_MZONE,0,1,e:GetHandler())",
      "Duel.IsExistingTarget(Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)",
      "Duel.GetFirstTarget()",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetValue(0)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid), restored.session.state)).toBe(0)",
      "effectSetAttackFinal",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Sea Koala fixture kind explicit", () => {
    expect(seaKoalaKindCounts).toEqual({ beastConditionZeroStatRestore: 1 });
  });
});
