import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const edgeImpFrightfuloidKindCounts = { graveFusionFinalStatRestore: 1 } satisfies Record<EdgeImpFrightfuloidKind, number>;
type EdgeImpFrightfuloidKind = "graveFusionFinalStatRestore";

describe("Lua real Edge Imp Frightfuloid restore coverage", () => {
  it("keeps Edge Imp Frightfuloid's grave Fusion final-stat restore owned", () => {
    const file = "test/lua-real-script-edge-imp-frightfuloid-grave-fusion-final-stat.test.ts";
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
      'const frightfuloidCode = "34566435"',
      "Edge Imp Frightfuloid",
      "restores a graveyard Frightfur Fusion target into copied final ATK and DEF",
      "s.listed_series={SET_FRIGHTFUR}",
      "return (c:IsLocation(LOCATION_GRAVE) or c:IsFaceup()) and c:IsType(TYPE_FUSION) and c:IsSetCard(SET_FRIGHTFUR)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)",
      "tc:IsLocation(LOCATION_GRAVE) or tc:IsFaceup()",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(tc:GetBaseAttack())",
      "e2:SetCode(EFFECT_SET_DEFENSE_FINAL)",
      "e2:SetValue(tc:GetBaseDefense())",
      "effectSetAttackFinal",
      "effectSetDefenseFinal",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === frightfuloid.uid), restored.session.state)).toBe(2800)",
      "currentDefense(restored.session.state.cards.find((card) => card.uid === frightfuloid.uid), restored.session.state)).toBe(2100)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Edge Imp Frightfuloid fixture kind explicit", () => {
    expect(edgeImpFrightfuloidKindCounts).toEqual({ graveFusionFinalStatRestore: 1 });
  });
});
