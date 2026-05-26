import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const terraFirmaKindCounts = { releaseHeroAttackStatRestore: 1 } satisfies Record<TerraFirmaKind, number>;
type TerraFirmaKind = "releaseHeroAttackStatRestore";

describe("Lua real Elemental HERO Terra Firma restore coverage", () => {
  it("keeps Terra Firma's Fusion metadata and HERO release stat restore owned", () => {
    const file = "test/lua-real-script-terra-firma-release-hero-attack-stat.test.ts";
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
      'const terraFirmaCode = "74711057"',
      "Elemental HERO Terra Firma",
      "restores Fusion metadata and Elemental HERO release cost into phase-end ATK gain",
      "Fusion.AddProcMix(c,true,true,37195861,75434695)",
      "s.material_setcode={SET_HERO,SET_ELEMENTAL_HERO}",
      "Duel.CheckReleaseGroupCost(tp,Card.IsSetCard,1,false,nil,e:GetHandler(),SET_ELEMENTAL_HERO)",
      "Duel.SelectReleaseGroupCost(tp,Card.IsSetCard,1,1,false,nil,e:GetHandler(),SET_ELEMENTAL_HERO)",
      "e:SetLabel(g:GetFirst():GetAttack())",
      "Duel.Release(g,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(e:GetLabel())",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e2:SetCode(EFFECT_SPSUMMON_CONDITION)",
      "e2:SetValue(aux.fuslimit)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === terraFirma.uid), restored.session.state)).toBe(4100)",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
      "eventReasonEffectId: 1",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Elemental HERO Terra Firma fixture kind explicit", () => {
    expect(terraFirmaKindCounts).toEqual({ releaseHeroAttackStatRestore: 1 });
  });
});
