export const freeChainSpecialSummonFixtureCount = 2;

export const freeChainSpecialSummonKindCounts = {
  handNormalMonsterSummon: 1,
  targetBanishedRockSummonStep: 1,
} satisfies Record<FreeChainSpecialSummonKind, number>;

export type FreeChainSpecialSummonKind = "handNormalMonsterSummon" | "targetBanishedRockSummonStep";

export function realScriptFreeChainSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: FreeChainSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-ancient-rules-hand-special-summon.test.ts",
      kind: "handNormalMonsterSummon",
      required: [
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        "category: 0x200",
        "parameter: 0x2",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
    {
      file: "test/lua-real-script-release-from-stone-banished-revive-destroy.test.ts",
      kind: "targetBanishedRockSummonStep",
      required: [
        "Duel.IsExistingTarget(s.filter,tp,LOCATION_REMOVED,0,1,nil,e,tp)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)",
        "Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)",
        "Duel.SpecialSummonComplete()",
        "operationInfos: [{ category: 0x200",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
  ];
}

export function countFreeChainSpecialSummonKinds(
  files: Array<{ kind: FreeChainSpecialSummonKind }>,
): Record<FreeChainSpecialSummonKind, number> {
  return files.reduce<Record<FreeChainSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { handNormalMonsterSummon: 0, targetBanishedRockSummonStep: 0 });
}
