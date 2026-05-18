export const releaseCostSpecialSummonFixtureCount = 3;

export const releaseCostSpecialSummonKindCounts = {
  releaseGroupCostHandDeckSummon: 1,
  releaseGroupCostHandSummonLeaveDestroy: 1,
  selfReleaseCostDeckSummon: 1,
} satisfies Record<ReleaseCostSpecialSummonKind, number>;

export type ReleaseCostSpecialSummonKind = "releaseGroupCostHandDeckSummon" | "releaseGroupCostHandSummonLeaveDestroy" | "selfReleaseCostDeckSummon";

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
    file: "test/lua-real-script-storming-wynn-release-summon-leave-destroy.test.ts",
    kind: "releaseGroupCostHandSummonLeaveDestroy",
    required: [
      "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,e:GetHandler(),ft,tp)",
      "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,e:GetHandler(),ft,tp)",
      "Duel.Release(g,REASON_COST)",
      "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      "e1:SetCode(EVENT_LEAVE_FIELD)",
      "if eg:IsExists(Card.IsCode,1,nil,id) then",
      "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
      "duelReason.release | duelReason.cost",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      'triggerEvent === "leftField"',
      'eventName === "destroyed"',
      "reasonCardUid: summonTarget.uid",
      "category: 0x200",
      "parameter: 0x2",
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
  }, { releaseGroupCostHandDeckSummon: 0, releaseGroupCostHandSummonLeaveDestroy: 0, selfReleaseCostDeckSummon: 0 });
}
