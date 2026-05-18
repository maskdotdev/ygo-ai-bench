export const freeChainSpecialSummonFixtureCount = 1;

export const freeChainSpecialSummonKindCounts = {
  handNormalMonsterSummon: 1,
} satisfies Record<FreeChainSpecialSummonKind, number>;

export type FreeChainSpecialSummonKind = "handNormalMonsterSummon";

export function realScriptFreeChainSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: FreeChainSpecialSummonKind;
  required: string[];
}> {
  return [{
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
  }];
}

export function countFreeChainSpecialSummonKinds(
  files: Array<{ kind: FreeChainSpecialSummonKind }>,
): Record<FreeChainSpecialSummonKind, number> {
  return files.reduce<Record<FreeChainSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { handNormalMonsterSummon: 0 });
}
