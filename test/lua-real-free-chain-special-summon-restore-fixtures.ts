export const freeChainSpecialSummonFixtureCount = 13;

export const freeChainSpecialSummonKindCounts = {
  continuousSpellIgnitionHandSummon: 1,
  handNormalMonsterSummon: 1,
  lpCostTargetGraveSetcodeSummon: 1,
  nonTargetGraveSetcodeDefenseSummon: 1,
  opponentTargetLevelHandSummon: 1,
  rankUpMagicXyzOverlaySummon: 1,
  trapMonsterAnnounceTraitSummonStep: 1,
  targetBanishedRockSummonStep: 1,
  targetGraveDragonSummonReplace: 1,
  targetGraveNormalDragonOathSummon: 1,
  targetGraveSetcodeSummonSelfBanishToHand: 1,
  targetGraveSetcodeDefenseSummon: 1,
  targetGraveSetcodeSummonEndDestroy: 1,
} satisfies Record<FreeChainSpecialSummonKind, number>;

export type FreeChainSpecialSummonKind =
  | "continuousSpellIgnitionHandSummon"
  | "handNormalMonsterSummon"
  | "lpCostTargetGraveSetcodeSummon"
  | "nonTargetGraveSetcodeDefenseSummon"
  | "opponentTargetLevelHandSummon"
  | "rankUpMagicXyzOverlaySummon"
  | "trapMonsterAnnounceTraitSummonStep"
  | "targetBanishedRockSummonStep"
  | "targetGraveDragonSummonReplace"
  | "targetGraveNormalDragonOathSummon"
  | "targetGraveSetcodeSummonSelfBanishToHand"
  | "targetGraveSetcodeDefenseSummon"
  | "targetGraveSetcodeSummonEndDestroy";

export function realScriptFreeChainSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: FreeChainSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-rival-appears-target-level-hand-summon.test.ts",
      kind: "opponentTargetLevelHandSummon",
      required: [
        "Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil,e,tp)",
        "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)",
        "local tc=Duel.GetFirstTarget()",
        "Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp,tc:GetLevel())",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        "targetUids: [opponent.uid]",
        "wrongLevel",
        "operationInfos: [{ category: 0x200",
        "parameter: 0x2",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
    {
      file: "test/lua-real-script-battery-charger-lp-target-revive.test.ts",
      kind: "lpCostTargetGraveSetcodeSummon",
      required: [
        "e1:SetCost(Cost.PayLP(500))",
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
        "Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)",
        "local tc=Duel.GetFirstTarget()",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        'eventName: "lifePointCostPaid"',
        "eventValue: 500",
        "eventReason: duelReason.cost",
        "operationInfos: [{ category: 0x200",
        "targetUids: [target.uid]",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
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
      file: "test/lua-real-script-limited-barians-force-rank-up-overlay.test.ts",
      kind: "rankUpMagicXyzOverlaySummon",
      required: [
        "aux.GetMustBeMaterialGroup(tp,Group.FromCards(c),tp,nil,nil,REASON_XYZ)",
        "Duel.GetLocationCountFromEx(tp,tp,mc,c)>0",
        "Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil,e,tp)",
        "Duel.SelectMatchingCard(tp,s.filter2,tp,LOCATION_EXTRA,0,1,1,nil,e,tp,tc,tc:GetRank()+1,pg)",
        "sc:SetMaterial(tc)",
        "Duel.Overlay(sc,tc)",
        "Duel.SpecialSummon(sc,SUMMON_TYPE_XYZ,tp,tp,false,false,POS_FACEUP)",
        "sc:CompleteProcedure()",
        "operationInfos: [{ category: 0x200",
        "parameter: 0x40",
        'summonType: "xyz"',
        "overlayUids: [rank4.uid, priorMaterial.uid]",
        "summonMaterialUids: [rank4.uid]",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
      ],
    },
    {
      file: "test/lua-real-script-swamp-mirrorer-announce-trap-monster.test.ts",
      kind: "trapMonsterAnnounceTraitSummonStep",
      required: [
        "Duel.AnnounceRace(tp,1,e:GetLabel())",
        "Duel.AnnounceAttribute(tp,1,att)",
        "Duel.SetTargetParam(catt)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)",
        "c:AddMonsterAttribute(TYPE_NORMAL+TYPE_TRAP,att,rac,0,0,0)",
        "Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP)",
        "c:AddMonsterAttributeComplete()",
        "Duel.SpecialSummonComplete()",
        'api: "AnnounceRace"',
        'api: "AnnounceAttribute"',
        "targetParam: 0x1",
        "typeFlags: typeMonster | typeTrap | typeNormal",
        "race: raceWarrior",
        "attribute: 0x1",
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
      file: "test/lua-real-script-silvers-cry-normal-dragon-revive.test.ts",
      kind: "targetGraveNormalDragonOathSummon",
      required: [
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "return c:IsRace(RACE_DRAGON) and c:IsType(TYPE_NORMAL) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        "Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)",
        "Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,0)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "typeMonster | typeNormal",
        "effectDragonDecoy",
        "normalWarriorDecoy",
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
      file: "test/lua-real-script-speed-recovery-revive-self-banish-to-hand.test.ts",
      kind: "targetGraveSetcodeSummonSelfBanishToHand",
      required: [
        "restores targeted Graveyard Speedroid summon and later aux.exccon self-banish add-to-hand",
        "return c:IsSetCard(SET_SPEEDROID) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "e2:SetCondition(aux.exccon)",
        "e2:SetCost(Cost.SelfBanish)",
        "return c:IsSetCard(SET_SPEEDROID) and c:IsMonster() and c:IsAbleToHand()",
        "Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SendtoHand(tc,nil,REASON_EFFECT)",
        "operationInfos: [{ category: 0x200",
        "operationInfos: [{ category: 0x8",
        'eventName: "specialSummoned"',
        'eventName: "banished"',
        'eventName: "sentToHand"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
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
  }, { continuousSpellIgnitionHandSummon: 0, handNormalMonsterSummon: 0, lpCostTargetGraveSetcodeSummon: 0, nonTargetGraveSetcodeDefenseSummon: 0, opponentTargetLevelHandSummon: 0, rankUpMagicXyzOverlaySummon: 0, trapMonsterAnnounceTraitSummonStep: 0, targetBanishedRockSummonStep: 0, targetGraveDragonSummonReplace: 0, targetGraveNormalDragonOathSummon: 0, targetGraveSetcodeDefenseSummon: 0, targetGraveSetcodeSummonEndDestroy: 0, targetGraveSetcodeSummonSelfBanishToHand: 0 });
}
