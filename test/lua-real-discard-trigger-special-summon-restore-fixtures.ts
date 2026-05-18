export const discardTriggerSpecialSummonFixtureCount = 1;

export const discardTriggerSpecialSummonKindCounts = {
  mandatoryDiscardSelfSummon: 1,
} satisfies Record<DiscardTriggerSpecialSummonKind, number>;

export type DiscardTriggerSpecialSummonKind = "mandatoryDiscardSelfSummon";

export function realScriptDiscardTriggerSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: DiscardTriggerSpecialSummonKind;
  required: string[];
}> {
  return [{
    file: "test/lua-real-script-the-fabled-cerburrel-discard-trigger-self-summon.test.ts",
    kind: "mandatoryDiscardSelfSummon",
    required: [
      "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
      "e1:SetCode(EVENT_TO_GRAVE)",
      "e:GetHandler():IsPreviousLocation(LOCATION_HAND) and (r&REASON_DISCARD)~=0",
      "Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)",
      "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
      "Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "discarded"',
      'eventName: "sentToGraveyard"',
      'eventTriggerTiming: "when"',
      "eventUids: [cerburrel.uid, opponentDiscard.uid, preChainResponder.uid]",
      "category: 0x200",
      "targetUids: [cerburrel.uid]",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      'summonType: "special"',
    ],
  }];
}

export function countDiscardTriggerSpecialSummonKinds(
  files: Array<{ kind: DiscardTriggerSpecialSummonKind }>,
): Record<DiscardTriggerSpecialSummonKind, number> {
  return files.reduce<Record<DiscardTriggerSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { mandatoryDiscardSelfSummon: 0 });
}
