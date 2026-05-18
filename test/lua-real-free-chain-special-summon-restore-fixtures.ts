export const freeChainSpecialSummonFixtureCount = 7;

export const freeChainSpecialSummonKindCounts = {
  continuousSpellIgnitionHandSummon: 1,
  handNormalMonsterSummon: 1,
  nonTargetGraveSetcodeDefenseSummon: 1,
  targetBanishedRockSummonStep: 1,
  targetGraveDragonSummonReplace: 1,
  targetGraveSetcodeDefenseSummon: 1,
  targetGraveSetcodeSummonEndDestroy: 1,
} satisfies Record<FreeChainSpecialSummonKind, number>;

export type FreeChainSpecialSummonKind =
  | "continuousSpellIgnitionHandSummon"
  | "handNormalMonsterSummon"
  | "nonTargetGraveSetcodeDefenseSummon"
  | "targetBanishedRockSummonStep"
  | "targetGraveDragonSummonReplace"
  | "targetGraveSetcodeDefenseSummon"
  | "targetGraveSetcodeSummonEndDestroy";

export function realScriptFreeChainSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: FreeChainSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-darklord-contact-grave-defense-summon.test.ts",
      kind: "nonTargetGraveSetcodeDefenseSummon",
      required: [
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "return c:IsSetCard(SET_DARKLORD) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)",
        "operationInfos: [{ category: 0x200",
        "parameter: 0x10",
        'position: "faceUpDefense"',
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        "eventReasonEffectId: 1",
        'summonType: "special"',
      ],
    },
    {
      file: "test/lua-real-script-court-justice-continuous-spell-summon.test.ts",
      kind: "continuousSpellIgnitionHandSummon",
      required: [
        "e2:SetRange(LOCATION_SZONE)",
        "return c:IsFaceup() and c:GetLevel()==1 and c:IsRace(RACE_FAIRY)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        'activationLocation: "spellTrapZone"',
        "category: 0x200",
        "parameter: 0x2",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        "eventReasonEffectId: 2",
        'summonType: "special"',
      ],
    },
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
    {
      file: "test/lua-real-script-return-dragon-lords-revive-replace.test.ts",
      kind: "targetGraveDragonSummonReplace",
      required: [
        "return c:IsRace(RACE_DRAGON) and (c:GetLevel()==7 or c:GetLevel()==8) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "operationInfos: [{ category: 0x200",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
    {
      file: "test/lua-real-script-junk-box-revive-end-destroy.test.ts",
      kind: "targetGraveSetcodeSummonEndDestroy",
      required: [
        "return c:IsSetCard(SET_MORPHTRONIC) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "operationInfos: [{ category: 0x200",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
        'triggerEvent: "phaseEnd"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-mayhem-fur-hire-target-revive-summon.test.ts",
      kind: "targetGraveSetcodeDefenseSummon",
      required: [
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "return c:IsSetCard(SET_FUR_HIRE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)",
        "Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)",
        "operationInfos: [{ category: 0x200",
        'position: "faceUpDefense"',
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        "eventReasonEffectId: 1",
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
  }, { continuousSpellIgnitionHandSummon: 0, handNormalMonsterSummon: 0, nonTargetGraveSetcodeDefenseSummon: 0, targetBanishedRockSummonStep: 0, targetGraveDragonSummonReplace: 0, targetGraveSetcodeDefenseSummon: 0, targetGraveSetcodeSummonEndDestroy: 0 });
}
