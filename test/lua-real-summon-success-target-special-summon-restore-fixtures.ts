export const summonSuccessTargetSpecialSummonFixtureCount = 3;

export const summonSuccessTargetSpecialSummonKindCounts = {
  graveyardTargetDefenseRevive: 1,
  deckOrGraveNecroValleySummon: 1,
  specialSummonSuccessTrapTargetRevive: 1,
} satisfies Record<SummonSuccessTargetSpecialSummonKind, number>;

export type SummonSuccessTargetSpecialSummonKind =
  | "deckOrGraveNecroValleySummon"
  | "graveyardTargetDefenseRevive"
  | "specialSummonSuccessTrapTargetRevive";

export function realScriptSummonSuccessTargetSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: SummonSuccessTargetSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-call-reaper-special-summon-success-target-revive.test.ts",
    kind: "specialSummonSuccessTrapTargetRevive",
    required: [
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)",
      "Duel.GetFirstTarget()",
      "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "specialSummoned"',
      'activationLocation: "spellTrapZone"',
      "targetUids: [listedTarget.uid]",
      "operationInfos: [{ category: 0x200",
      'summonType: "special"',
      "reasonCardUid: callReaper.uid",
    ],
  }, {
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
  }, {
    file: "test/lua-real-script-nimble-beaver-necrovalley-summon.test.ts",
    kind: "deckOrGraveNecroValleySummon",
    required: [
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK|LOCATION_GRAVE,0,1,nil,e,tp)",
      "Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "normalSummoned"',
      'eventTriggerTiming: "when"',
      "triggerBucket: \"turnOptional\"",
      "operationInfos: [{ category: 0x200",
      "parameter: 0x11",
      'eventName: "specialSummoned"',
      'summonType: "special"',
      "reason: duelReason.summon | duelReason.specialSummon",
    ],
  }];
}

export function countSummonSuccessTargetSpecialSummonKinds(
  files: Array<{ kind: SummonSuccessTargetSpecialSummonKind }>,
): Record<SummonSuccessTargetSpecialSummonKind, number> {
  return files.reduce<Record<SummonSuccessTargetSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { deckOrGraveNecroValleySummon: 0, graveyardTargetDefenseRevive: 0, specialSummonSuccessTrapTargetRevive: 0 });
}
