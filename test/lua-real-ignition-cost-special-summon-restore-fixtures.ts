export const ignitionCostSpecialSummonFixtureCount = 4;

export const ignitionCostSpecialSummonKindCounts = {
  dragonRulerDiscardDeckSummonCannotAttack: 1,
  graveCostSelfSummonSearchRedirect: 1,
  handCostSelfSummon: 1,
  overlayDetachSelfSummonSearch: 1,
} satisfies Record<IgnitionCostSpecialSummonKind, number>;

export type IgnitionCostSpecialSummonKind =
  | "dragonRulerDiscardDeckSummonCannotAttack"
  | "graveCostSelfSummonSearchRedirect"
  | "handCostSelfSummon"
  | "overlayDetachSelfSummonSearch";

export function realScriptIgnitionCostSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: IgnitionCostSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-stream-dragon-ruler-deck-summon-cannot-attack.test.ts",
      kind: "dragonRulerDiscardDeckSummonCannotAttack",
      required: [
        "DragonRuler.SelfDiscardCost(ATTRIBUTE_WATER)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)",
        "Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)",
        "EFFECT_CANNOT_ATTACK",
        "Duel.SpecialSummonComplete()",
        "eventReason: duelReason.cost | duelReason.discard",
        'eventName: "sentToGraveyard"',
        "operationInfos: [{ category: 0x200, count: 1, parameter: 0x1, player: 0, targetUids: [] }]",
        "isAttackPrevented",
        "effect.sourceUid === tidal.uid",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
      ],
    },
    {
      file: "test/lua-real-script-vampire-familiar-grave-summon-search-redirect.test.ts",
      kind: "graveCostSelfSummonSearchRedirect",
      required: [
        "e1:SetCost(Cost.PayLP(500))",
        "Duel.IsExistingMatchingCard(s.costfilter,tp,LOCATION_ONFIELD|LOCATION_HAND,0,1,nil,tp)",
        "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_ONFIELD|LOCATION_HAND,0,1,1,nil,tp)",
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        "EFFECT_LEAVE_FIELD_REDIRECT",
        "e1:SetValue(LOCATION_REMOVED)",
        "eventReason: duelReason.cost",
        'eventName: "sentToGraveyard"',
        "category: 0x200",
        "targetUids: [familiar.uid]",
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'eventName: "lifePointCostPaid"',
        'eventName: "sentToHand"',
        "duelReason.effect | duelReason.redirect",
      ],
    },
    {
      file: "test/lua-real-script-goblin-biker-dugg-overlay-summon-search.test.ts",
      kind: "overlayDetachSelfSummonSearch",
      required: [
        "Duel.CheckRemoveOverlayCard(tp,1,1,1,REASON_EFFECT)",
        "Duel.RemoveOverlayCard(tp,1,1,1,1,REASON_EFFECT)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)",
        "Duel.SendtoHand(g,nil,REASON_EFFECT)",
        "Duel.ConfirmCards(1-tp,g)",
        'eventName: "detachedMaterial"',
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        'summonType: "special"',
        'eventName: "sentToHand"',
      ],
    },
    {
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
    },
  ];
}

export function countIgnitionCostSpecialSummonKinds(
  files: Array<{ kind: IgnitionCostSpecialSummonKind }>,
): Record<IgnitionCostSpecialSummonKind, number> {
  return files.reduce<Record<IgnitionCostSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { dragonRulerDiscardDeckSummonCannotAttack: 0, graveCostSelfSummonSearchRedirect: 0, handCostSelfSummon: 0, overlayDetachSelfSummonSearch: 0 });
}
