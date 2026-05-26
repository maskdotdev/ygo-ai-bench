import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const violetChimeraKindCounts = { fusionMaterialCheckAttackStatRestore: 1 } satisfies Record<VioletChimeraKind, number>;
type VioletChimeraKind = "fusionMaterialCheckAttackStatRestore";

describe("Lua real Salamangreat Violet Chimera restore coverage", () => {
  it("keeps Violet Chimera's Fusion material-check ATK restore owned", () => {
    const file = "test/lua-real-script-salamangreat-violet-chimera-fusion-material-battle-stat.test.ts";
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
      'const chimeraCode = "37261776"',
      "Salamangreat Violet Chimera",
      "restores Fusion material ATK label into summon ATK boost",
      "aux.EnableCheckReincarnation(c)",
      "Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_SALAMANGREAT),aux.FilterBoolFunctionEx(Card.IsType,TYPE_LINK))",
      "fusionRequiredMaterialPredicates).toEqual([{ setcode: setSalamangreat }, { type: typeLink }])",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e2:SetCode(EFFECT_MATERIAL_CHECK)",
      "local g=c:GetMaterial()",
      "if #g>0 then atk=g:GetSum(Card.GetBaseAttack) end",
      "e:GetLabelObject():SetLabel(atk)",
      "Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,e:GetLabel()/2)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(e:GetLabel()/2)",
      "e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e4:SetCode(EFFECT_SET_ATTACK)",
      "return c:IsReincarnationSummoned() and c:IsFusionSummoned() and Duel.IsPhase(PHASE_DAMAGE_CAL)",
      "summonMaterialUids: [salamangreatMaterial.uid, linkMaterial.uid]",
      "currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === chimera.uid), restoredTrigger.session.state)).toBe(4400)",
      'eventName: "usedAsMaterial"',
      'eventName: "specialSummoned"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Violet Chimera fixture kind explicit", () => {
    expect(violetChimeraKindCounts).toEqual({ fusionMaterialCheckAttackStatRestore: 1 });
  });
});
