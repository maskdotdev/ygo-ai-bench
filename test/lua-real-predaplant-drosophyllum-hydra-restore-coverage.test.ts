import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const hydraKindCounts = { predaplantBanishTargetAttackDrop: 1 } satisfies Record<HydraKind, number>;
type HydraKind = "predaplantBanishTargetAttackDrop";

describe("Lua real Predaplant Drosophyllum Hydra restore coverage", () => {
  it("keeps Hydra's Predaplant banish-cost target ATK drop restore owned", () => {
    const file = "test/lua-real-script-predaplant-drosophyllum-hydra-banish-target-stat.test.ts";
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
      'const hydraCode = "99913726"',
      "Predaplant Drosophyllum Hydra",
      "restores Predaplant banish cost into targeted ATK loss",
      "e1:SetCode(EFFECT_SPSUMMON_PROC)",
      "EFFECT_NECRO_VALLEY",
      "aux.SelectUnselectGroup(rg,e,tp,1,1,nil,0)",
      "aux.SelectUnselectGroup(rg,e,tp,1,1,nil,1,tp,HINTMSG_RELEASE,nil,nil,true)",
      "Duel.Release(g,REASON_COST)",
      "e2:SetCategory(CATEGORY_ATKCHANGE)",
      "e2:SetCode(EVENT_FREE_CHAIN)",
      "e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)",
      "aux.SpElimFilter(c,true)",
      "Duel.SelectMatchingCard(tp,s.atkcfil,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-500)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "reasonEffectId: 2",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid)!, restored.session.state)).toBe(1500)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Hydra fixture kind explicit", () => {
    expect(hydraKindCounts).toEqual({ predaplantBanishTargetAttackDrop: 1 });
  });
});
