export const ignitionCostSpecialSummonFixtureCount = 2;

export const ignitionCostSpecialSummonKindCounts = {
  dragonRulerDiscardDeckSummonCannotAttack: 1,
  handCostSelfSummon: 1,
} satisfies Record<IgnitionCostSpecialSummonKind, number>;

export type IgnitionCostSpecialSummonKind =
  | "dragonRulerDiscardDeckSummonCannotAttack"
  | "handCostSelfSummon";

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
  }, { dragonRulerDiscardDeckSummonCannotAttack: 0, handCostSelfSummon: 0 });
}
