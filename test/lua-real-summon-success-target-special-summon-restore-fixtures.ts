export const summonSuccessTargetSpecialSummonFixtureCount = 1;

export const summonSuccessTargetSpecialSummonKindCounts = {
  graveyardTargetDefenseRevive: 1,
} satisfies Record<SummonSuccessTargetSpecialSummonKind, number>;

export type SummonSuccessTargetSpecialSummonKind = "graveyardTargetDefenseRevive";

export function realScriptSummonSuccessTargetSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: SummonSuccessTargetSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-gishki-beast-summon-target-revive.test.ts",
    kind: "graveyardTargetDefenseRevive",
    required: [
      "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)",
      "Duel.GetFirstTarget()",
      "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)",
      'eventName: "normalSummoned"',
      'eventTriggerTiming: "when"',
      "triggerBucket: \"turnOptional\"",
      "targetUids: [gishkiTarget.uid]",
      "category: 0x200",
      'eventName: "specialSummoned"',
      'position: "faceUpDefense"',
      'summonType: "special"',
      "eventReason).toBe(duelReason.summon | duelReason.specialSummon)",
    ],
  }];
}

export function countSummonSuccessTargetSpecialSummonKinds(
  files: Array<{ kind: SummonSuccessTargetSpecialSummonKind }>,
): Record<SummonSuccessTargetSpecialSummonKind, number> {
  return files.reduce<Record<SummonSuccessTargetSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { graveyardTargetDefenseRevive: 0 });
}
