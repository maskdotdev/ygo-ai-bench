import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const gemKnightRubyKindCounts = { releasePierceStatRestore: 1 } satisfies Record<GemKnightRubyKind, number>;
type GemKnightRubyKind = "releasePierceStatRestore";

describe("Lua real Gem-Knight Ruby restore coverage", () => {
  it("keeps Gem-Knight Ruby's Fusion, pierce, and release-cost stat restore owned", () => {
    const file = "test/lua-real-script-gem-knight-ruby-release-pierce-stat.test.ts";
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
      'const rubyCode = "76614340"',
      "Gem-Knight Ruby",
      "restores Fusion metadata, pierce, and Gem release cost into ATK gain",
      "Fusion.AddProcMix(c,false,false,91731841,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GEM_KNIGHT))",
      "e2:SetCode(EFFECT_SPSUMMON_CONDITION)",
      "return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION",
      "return c:IsFaceup() and c:IsSetCard(SET_GEM)",
      "Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,e:GetHandler())",
      "Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,e:GetHandler())",
      "e:SetLabel(rg:GetFirst():GetAttack())",
      "Duel.Release(rg,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(e:GetLabel())",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)",
      "e4:SetCode(EFFECT_PIERCE)",
      "effectPierce",
      "reasonEffectId: 3",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === ruby.uid), restored.session.state)).toBe(3900)",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
      "eventReasonEffectId: 3",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Gem-Knight Ruby fixture kind explicit", () => {
    expect(gemKnightRubyKindCounts).toEqual({ releasePierceStatRestore: 1 });
  });
});
