export const releaseCostSpecialSummonFixtureCount = 1;

export const releaseCostSpecialSummonKindCounts = {
  releaseGroupCostHandDeckSummon: 1,
} satisfies Record<ReleaseCostSpecialSummonKind, number>;

export type ReleaseCostSpecialSummonKind = "releaseGroupCostHandDeckSummon";

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
  }];
}

export function countReleaseCostSpecialSummonKinds(
  files: Array<{ kind: ReleaseCostSpecialSummonKind }>,
): Record<ReleaseCostSpecialSummonKind, number> {
  return files.reduce<Record<ReleaseCostSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { releaseGroupCostHandDeckSummon: 0 });
}
