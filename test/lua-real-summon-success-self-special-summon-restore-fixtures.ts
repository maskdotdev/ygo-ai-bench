export const summonSuccessSelfSpecialSummonFixtureCount = 1;

export const summonSuccessSelfSpecialSummonKindCounts = {
  handRangeSelfSummonUnsynchroable: 1,
} satisfies Record<SummonSuccessSelfSpecialSummonKind, number>;

export type SummonSuccessSelfSpecialSummonKind = "handRangeSelfSummonUnsynchroable";

export function realScriptSummonSuccessSelfSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: SummonSuccessSelfSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-kagetokage-summon-trigger-self-special.test.ts",
    kind: "handRangeSelfSummonUnsynchroable",
    required: [
      "e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)",
      "e1:SetRange(LOCATION_HAND)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "return ep==tp and ec:GetLevel()==4",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
      "Duel.SpecialSummon(c,0,tp,tp,true,false,POS_FACEUP)",
      "c:CompleteProcedure()",
      "e2:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)",
      'activationLocation: "hand"',
      'eventName: "normalSummoned"',
      'eventTriggerTiming: "when"',
      "triggerBucket: \"turnOptional\"",
      "operationInfos: [{ category: 0x200",
      'eventName: "specialSummoned"',
      'summonType: "special"',
      "range: expect.arrayContaining([\"hand\", \"monsterZone\"])",
      "cannot be used as synchro material",
    ],
  }];
}

export function countSummonSuccessSelfSpecialSummonKinds(
  files: Array<{ kind: SummonSuccessSelfSpecialSummonKind }>,
): Record<SummonSuccessSelfSpecialSummonKind, number> {
  return files.reduce<Record<SummonSuccessSelfSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { handRangeSelfSummonUnsynchroable: 0 });
}
