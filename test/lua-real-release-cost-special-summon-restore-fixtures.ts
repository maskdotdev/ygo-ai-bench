export const releaseCostSpecialSummonFixtureCount = 6;

export const releaseCostSpecialSummonKindCounts = {
  releaseGroupCostHandDeckSummon: 1,
  releaseGroupCostHandProcedure: 1,
  releaseGroupCostHandSelfSummonSearch: 1,
  releaseGroupCostHandSummonLeaveDestroy: 1,
  selfReleaseCostDeckSummon: 2,
} satisfies Record<ReleaseCostSpecialSummonKind, number>;

export type ReleaseCostSpecialSummonKind = "releaseGroupCostHandDeckSummon" | "releaseGroupCostHandProcedure" | "releaseGroupCostHandSelfSummonSearch" | "releaseGroupCostHandSummonLeaveDestroy" | "selfReleaseCostDeckSummon";

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
    file: "test/lua-real-script-drytron-alpha-tribute-summon-search.test.ts",
    kind: "releaseGroupCostHandSelfSummonSearch",
    required: [
      "Drytron.TributeCost",
      "Drytron.TributeCost=Cost.AND(Cost.Replaceable(tribute_base_cost,extracon),tribute_extra_cost)",
      "Duel.Release(sg,REASON_COST)",
      "e1:SetTarget(function(e,c) return c:IsSummonableCard() end)",
      "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,2))",
      "Duel.BreakEffect()",
      "Duel.SendtoHand(sg,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,sg)",
      "duelReason.cost | duelReason.release",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      'eventName: "sentToHand"',
      "special-summon-limit:summonable-card",
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "operationInfos: [{ category: 0x200, targetUids: [alpha.uid], count: 1, player: 0, parameter: 0x2 }]",
      "possibleOperationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }]",
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
    file: "test/lua-real-script-toon-summoned-skull-release-attack-cost.test.ts",
    kind: "releaseGroupCostHandProcedure",
    required: [
      "Duel.CheckReleaseGroup(c:GetControler(),aux.TRUE,1,false,1,true,c,c:GetControler(),nil,false,nil)",
      "Duel.SelectReleaseGroup(tp,aux.TRUE,1,1,false,true,true,c,nil,nil,false,nil)",
      "Duel.Release(g,REASON_COST)",
      'type === "specialSummonProcedure"',
      'summonType: "special"',
      "duelReason.release | duelReason.cost",
      'eventName: "released"',
      "eventReasonEffectId: 2",
    ],
  }, {
    file: "test/lua-real-script-skilled-blue-magician-counter-summon.test.ts",
    kind: "selfReleaseCostDeckSummon",
    required: [
      "Duel.Release(e:GetHandler(),REASON_COST)",
      "Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      "duelReason.cost | duelReason.release",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "operationInfos: [{ category: categorySpecialSummon, count: 1, player: 0, parameter: 19, targetUids: [] }]",
      "tc:AddCounter(COUNTER_SPELL,1)",
      "operationInfos: [{ category: categoryCounter, count: 1, player: 0, parameter: counterSpell, targetUids: [] }]",
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
  }, { releaseGroupCostHandDeckSummon: 0, releaseGroupCostHandProcedure: 0, releaseGroupCostHandSelfSummonSearch: 0, releaseGroupCostHandSummonLeaveDestroy: 0, selfReleaseCostDeckSummon: 0 });
}
