import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const genomHeritageKindCounts = { targetCopyDisableStatRestore: 1 } satisfies Record<GenomHeritageKind, number>;
type GenomHeritageKind = "targetCopyDisableStatRestore";

describe("Lua real Genom-Heritage restore coverage", () => {
  it("keeps Genom-Heritage's target copy, disable, and stat restore owned", () => {
    const file = "test/lua-real-script-genom-heritage-target-copy-disable-stat.test.ts";
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
      'const genomCode = "47387961"',
      "Number 8: Heraldic King Genom-Heritage",
      "restores targeted Xyz code copy, base ATK adoption, and target disable with ATK zero",
      "Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_HERALDIC_BEAST),4,2)",
      "s.xyz_number=8",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return c:IsFaceup() and c:IsType(TYPE_XYZ)",
      "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
      "local code=tc:GetOriginalCode()",
      "e1:SetCode(EFFECT_CHANGE_CODE)",
      "e2:SetCode(EFFECT_SET_BASE_ATTACK)",
      "e2:SetValue(tc:GetAttack())",
      "c:CopyEffect(code,RESETS_STANDARD_PHASE_END,1)",
      "e3:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e3:SetValue(0)",
      "e4:SetCode(EFFECT_DISABLE)",
      "e5:SetCode(EFFECT_DISABLE_EFFECT)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === genom.uid), restored.session.state)).toBe(2800)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === targetXyz.uid), restored.session.state)).toBe(0)",
      "effectChangeCode",
      "effectSetBaseAttack",
      "effectSetAttackFinal",
      "effectDisableEffect",
      'eventName: "becameTarget"',
      "relatedEffectId: 2",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Genom-Heritage fixture kind explicit", () => {
    expect(genomHeritageKindCounts).toEqual({ targetCopyDisableStatRestore: 1 });
  });
});
