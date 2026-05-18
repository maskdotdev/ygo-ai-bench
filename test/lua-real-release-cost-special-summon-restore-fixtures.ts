export const releaseCostSpecialSummonFixtureCount = 2;

export const releaseCostSpecialSummonKindCounts = {
  releaseGroupCostHandDeckSummon: 1,
  selfReleaseCostDeckSummon: 1,
} satisfies Record<ReleaseCostSpecialSummonKind, number>;

export type ReleaseCostSpecialSummonKind = "releaseGroupCostHandDeckSummon" | "selfReleaseCostDeckSummon";

export function realScriptReleaseCostSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: ReleaseCostSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-rose-bud-release-cost-special-summon.test.ts",
    kind: "releaseGroupCostHandDeckSummon",
    required: [
      "Duel.CheckReleaseGroupCost",
      "Duel.SelectReleaseGroupCost",
      "Duel.Release(g,REASON_COST)",
      "Duel.SpecialSummon(tc,0,tp,tp,true,false,POS_FACEUP)",
      "duelReason.release | duelReason.cost",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "category: 0x200",
      "parameter: 0x3",
      "hasProcedureCompleteStatus",
    ],
  }, {
    file: "test/lua-real-script-lonefire-blossom-release-cost-deck-summon.test.ts",
    kind: "selfReleaseCostDeckSummon",
    required: [
      "Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,nil,ft,tp)",
      "Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,nil,ft,tp)",
      "Duel.Release(g,REASON_COST)",
      "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      "duelReason.release | duelReason.cost",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "category: 0x200",
      "parameter: 0x1",
    ],
  }];
}

export function countReleaseCostSpecialSummonKinds(
  files: Array<{ kind: ReleaseCostSpecialSummonKind }>,
): Record<ReleaseCostSpecialSummonKind, number> {
  return files.reduce<Record<ReleaseCostSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { releaseGroupCostHandDeckSummon: 0, selfReleaseCostDeckSummon: 0 });
}
