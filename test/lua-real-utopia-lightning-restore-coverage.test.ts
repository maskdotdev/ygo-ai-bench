import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const utopiaLightningKindCounts = { preDamageDetachFinalStatRestore: 1 } satisfies Record<UtopiaLightningKind, number>;
type UtopiaLightningKind = "preDamageDetachFinalStatRestore";

describe("Lua real Utopia the Lightning restore coverage", () => {
  it("keeps Utopia the Lightning's pre-damage detach final ATK restore owned", () => {
    const file = "test/lua-real-script-utopia-lightning-pre-damage-detach-final-stat.test.ts";
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
      'const lightningCode = "56832966"',
      "Number S39: Utopia the Lightning",
      "restores Utopia overlay-gated pre-damage detach into 5000 final ATK",
      "Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),5,3,s.ovfilter,aux.Stringid(id,0))",
      "e0:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)",
      "e1:SetCode(EFFECT_CANNOT_ACTIVATE)",
      "Duel.GetAttacker()==c or Duel.GetAttackTarget()==c",
      "e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
      "e2:SetCost(Cost.AND(Cost.DetachFromSelf(2),Cost.SoftOncePerBattle))",
      "c:GetOverlayGroup():IsExists(s.atkconfilter,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(5000)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)",
      "s.listed_series={SET_UTOPIA}",
      "s.xyz_number=39",
      "duelReason.material | duelReason.xyz",
      "reasonEffectId: 4",
      "currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === lightning.uid)!, restoredOpen.session.state)).toBe(5000)",
      "battleDamage).toEqual({ 0: 0, 1: 2000 })",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Utopia the Lightning fixture kind explicit", () => {
    expect(utopiaLightningKindCounts).toEqual({ preDamageDetachFinalStatRestore: 1 });
  });
});
