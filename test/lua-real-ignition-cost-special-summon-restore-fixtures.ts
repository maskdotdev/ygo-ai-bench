export const ignitionCostSpecialSummonFixtureCount = 1;

export const ignitionCostSpecialSummonKindCounts = {
  handCostSelfSummon: 1,
} satisfies Record<IgnitionCostSpecialSummonKind, number>;

export type IgnitionCostSpecialSummonKind = "handCostSelfSummon";

export function realScriptIgnitionCostSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: IgnitionCostSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-malicevorous-fork-cost-self-summon.test.ts",
    kind: "handCostSelfSummon",
    required: [
      "Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_HAND,0,1,e:GetHandler())",
      "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,e:GetHandler())",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
      "eventReason: duelReason.cost",
      'eventName: "sentToGraveyard"',
      "category: 0x200",
      "targetUids: [fork.uid]",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      'summonType: "special"',
    ],
  }];
}

export function countIgnitionCostSpecialSummonKinds(
  files: Array<{ kind: IgnitionCostSpecialSummonKind }>,
): Record<IgnitionCostSpecialSummonKind, number> {
  return files.reduce<Record<IgnitionCostSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { handCostSelfSummon: 0 });
}
