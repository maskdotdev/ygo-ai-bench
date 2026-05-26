import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const flamvellArcherKindCounts = { releaseGroupAttackStatRestore: 1 } satisfies Record<FlamvellArcherKind, number>;
type FlamvellArcherKind = "releaseGroupAttackStatRestore";

describe("Lua real Flamvell Archer restore coverage", () => {
  it("keeps Flamvell Archer's release cost and group attack restore owned", () => {
    const file = "test/lua-real-script-flamvell-archer-release-group-attack-stat.test.ts";
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
      'const archerCode = "54326448"',
      "Flamvell Archer",
      "restores Pyro release cost into all remaining face-up Flamvell ATK boosts",
      "s.listed_series={SET_FLAMVELL}",
      "return c:IsFaceup() and c:IsRace(RACE_PYRO)",
      "and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,c)",
      "return c:IsFaceup() and c:IsSetCard(SET_FLAMVELL)",
      "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,tp)",
      "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,tp)",
      "Duel.Release(g,REASON_COST)",
      "local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)",
      "for tc in aux.Next(g) do",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetValue(800)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "eventReasonEffectId: 1",
      "effectUpdateAttack",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === flamvellAlly.uid), restored.session.state)).toBe(2400)",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Flamvell Archer fixture kind explicit", () => {
    expect(flamvellArcherKindCounts).toEqual({ releaseGroupAttackStatRestore: 1 });
  });
});
