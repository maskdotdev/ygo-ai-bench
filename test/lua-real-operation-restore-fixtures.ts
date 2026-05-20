import path from "node:path";

export const operationFixtureCount = 81;
export const operationKindCounts = {
  costBanishDraw: 2, costDiscardDraw: 1,
  crossPlayerGraveToDeckTrap: 1,
  controlReturn: 1,
  controlSwap: 1,
  banishedToGraveReturn: 1,
  banishedToHand: 1,
  banishedToDeckSelfSummon: 1,
  banishedToSpecialSummon: 1,
  chainNegateDiscardDestroy: 1,
  chainNegateDestroyDraw: 1,
  chainNegateColumnDestroy: 1,
  chainLinkedZoneDisable: 1,
  deckToGrave: 1,
  deckSplit: 1,
  discardCostSpecialSummonGroupDestroy: 1,
  discardCostGraveToDeckTop: 1,
  directDamage: 1,
  directRecover: 1,
  drawThenDiscard: 1,
  flipDeckSpecialSummon: 1,
  flipTargetDestroy: 1,
  fusionDeckMaterials: 1,
  groupDestroy: 10,
  groupToHand: 1,
  graveToDeckBottomDraw: 1,
  handDiscardDraw: 1,
  handToDeckDraw: 1,
  fiveGraveToDeckShuffleDraw: 2,
  ignitionSelfGraveDeckSummon: 1,
  lpCostHandDiscard: 1,
  lpCostRandomHandDiscard: 1,
  monsterIgnitionSpellTrapDestroy: 1,
  mutualHandDiscardDraw: 1,
  opponentHandToDeck: 1,
  overlayAttach: 1,
  positionSet: 1,
  pzoneDestroySearch: 1,
  releaseDamage: 2,
  ritualDeckMaterials: 1,
  searchOrExcavate: 12,
  selfEquipFromHand: 1,
  spellDraw: 1,
  trapDraw: 1,
  targetBanish: 1,
  targetBanishDiscardCost: 1,
  targetDestroy: 1,
  targetDestroyDiscardCost: 2,
  targetDestroyDisableField: 1,
  targetDestroyReleaseCost: 1,
  targetDestroyRemove: 1,
  targetDestroyRecover: 1,
  targetDestroySkipDraw: 1,
  targetToHandDiscardCost: 1,
  trapDrawSkipDraw: 1,
  tossCoin: 1,
  tossDiceHandDiscard: 1,
} satisfies Record<OperationKind, number>;
export type OperationKind =
  | "costBanishDraw" | "costDiscardDraw"
  | "crossPlayerGraveToDeckTrap"
  | "controlReturn"
  | "controlSwap"
  | "banishedToGraveReturn"
  | "banishedToHand"
  | "banishedToDeckSelfSummon"
  | "banishedToSpecialSummon"
  | "chainNegateDiscardDestroy"
  | "chainNegateDestroyDraw"
  | "chainNegateColumnDestroy"
  | "chainLinkedZoneDisable"
  | "deckToGrave"
  | "deckSplit"
  | "discardCostSpecialSummonGroupDestroy"
  | "discardCostGraveToDeckTop"
  | "directDamage"
  | "directRecover"
  | "drawThenDiscard"
  | "flipDeckSpecialSummon"
  | "flipTargetDestroy"
  | "fusionDeckMaterials"
  | "groupDestroy"
  | "groupToHand"
  | "graveToDeckBottomDraw"
  | "handDiscardDraw"
  | "handToDeckDraw"
  | "fiveGraveToDeckShuffleDraw"
  | "ignitionSelfGraveDeckSummon"
  | "lpCostHandDiscard"
  | "lpCostRandomHandDiscard"
  | "monsterIgnitionSpellTrapDestroy"
  | "mutualHandDiscardDraw"
  | "opponentHandToDeck"
  | "overlayAttach"
  | "positionSet"
  | "pzoneDestroySearch"
  | "releaseDamage"
  | "ritualDeckMaterials"
  | "searchOrExcavate"
  | "selfEquipFromHand"
  | "spellDraw"
  | "trapDraw"
  | "targetBanish"
  | "targetBanishDiscardCost"
  | "targetDestroy"
  | "targetDestroyDiscardCost"
  | "targetDestroyDisableField"
  | "targetDestroyReleaseCost"
  | "targetDestroyRemove"
  | "targetDestroyRecover"
  | "targetDestroySkipDraw"
  | "targetToHandDiscardCost"
  | "trapDrawSkipDraw"
  | "tossCoin" | "tossDiceHandDiscard";
export function operationFixtureFiles(): Array<{
  file: string;
  kind: OperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-broken-line-column-negate.test.ts",
      kind: "chainNegateColumnDestroy",
      required: [
        "bit.extract column check",
        "category: 0x10000000",
        "category: 0x1",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'eventName: "destroyed"',
        "cardsDrawn",
        "recoveredLifePoints",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pitknight-earlie-linked-chain-disable.test.ts",
      kind: "chainLinkedZoneDisable",
      required: [
        "bit.extract linked-zone chain condition",
        "currentAttack(restoredStarter",
        "toEqual([2, 8, 102])",
        "cardsDrawn",
        "host.messages).not.toContain",
        "targetUids: [starter.uid]",
      ],
    },
    {
      file: "test/lua-real-script-burial-different-dimension-banish-return.test.ts",
      kind: "banishedToGraveReturn",
      required: [
        "category: 0x20",
        "duelReason.effect | duelReason.return",
        'eventName: "sentToGraveyard"',
        "eventUids: [ownBanishedA!.uid, ownBanishedB!.uid, opponentBanished!.uid]",
        'location: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-change-of-heart-control-return.test.ts",
      kind: "controlReturn",
      required: [
        "category: 0x2000",
        'eventName: "controlChanged"',
        "controller: 0",
        "controller: 1",
        "temporary-control-return",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-creature-swap-control-lock.test.ts",
      kind: "controlSwap",
      required: [
        "category: 0x2000",
        'eventName: "controlChanged"',
        "eventCardUid: ownMonster!.uid",
        "eventCardUid: opponentMonster!.uid",
        "positionLockCodes",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-book-of-moon-free-chain.test.ts",
      kind: "positionSet",
      required: [
        "category: 0x1000",
        "parameter: 8",
        'eventName: "positionChanged"',
        'position: "faceDownDefense"',
        "faceUp: false",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "chainNegateDestroyDraw",
      required: [
        "category: 0x10000000",
        "category: 0x10000",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'eventName: "cardsDrawn"',
        "recoveredLifePoints",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-magic-jammer-chain-negate.test.ts",
      kind: "chainNegateDiscardDestroy",
      required: [
        "category: 0x10000000",
        'eventName: "discarded"',
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        "cardsDrawn",
        "recoveredLifePoints",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-nemeses-adrastea-banished-special-summon.test.ts",
      kind: "banishedToSpecialSummon",
      required: [
        "category: 0x200",
        "parameter: 0x30",
        'eventName: "specialSummoned"',
        'location: "banished"',
        'location: "monsterZone"',
        'summonType: "special"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-nemeses-corridor-banished-to-hand.test.ts",
      kind: "banishedToHand",
      required: [
        "category: 0x8",
        "parameter: 0x20",
        'eventName: "sentToHand"',
        'location: "banished"',
        'location: "hand"',
        "eventReasonEffectId: 2",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-nemeses-keystone-banished-to-deck-summon.test.ts",
      kind: "banishedToDeckSelfSummon",
      required: [
        "category: 0x10",
        "category: 0x200",
        'eventName: "sentToDeck"',
        'eventName: "specialSummoned"',
        'location: "banished"',
        'location: "deck"',
        'summonType: "special"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gravekeeper-spy-flip-deck-summon.test.ts",
      kind: "flipDeckSpecialSummon",
      required: [
        "restores its Flip effect and Special Summons only a low-ATK Gravekeeper's monster from Deck",
        "EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)",
        "return c:IsAttackBelow(1500) and c:IsSetCard(SET_GRAVEKEEPERS)",
        "operationInfos: [{ category: 0x200",
        'eventName: "flipSummoned"',
        'eventName: "specialSummoned"',
        'summonType: "special"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-castle-gate-release-cost-damage.test.ts",
      kind: "releaseDamage",
      required: [
        "categoryDamage",
        "effectLabel: 1700",
        "targetParam: 1700",
        'eventName: "released"',
        'eventName: "damageDealt"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-cannon-soldier-release-self-damage.test.ts",
      kind: "releaseDamage",
      required: [
        "category: 0x80000",
        "targetParam: 500",
        'eventName: "released"',
        'eventName: "damageDealt"',
        "eventReasonCardUid: cannonSoldier.uid",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-card-destruction-discard-draw.test.ts",
      kind: "handDiscardDraw",
      required: [
        "category: 0x80",
        "category: 0x10000",
        'eventName: "discarded"',
        'eventName: "cardsDrawn"',
        "duelReason.effect | duelReason.discard",
        "host.messages).not.toContain",
      ],
    },
    { file: "test/lua-real-script-trade-in-discard-draw.test.ts", kind: "costDiscardDraw", required: ["Duel.DiscardHand(tp,s.filter,1,1,REASON_COST|REASON_DISCARD)", "Duel.SetTargetPlayer(tp)", "Duel.SetTargetParam(2)", "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)", "category: 0x10000", 'eventName: "discarded"', 'eventName: "cardsDrawn"', "duelReason.cost | duelReason.discard", "host.messages).not.toContain"] },
    {
      file: "test/lua-real-script-dark-hole-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "sortedUids([ownMonster!.uid, opponentAttack!.uid, opponentDefense!.uid])",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-radiant-spirit-battle-destroyed-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "targetUids: [darkTarget.uid, attacker.uid, facedownTarget.uid]",
        'eventName: "battleDestroyed"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dicelops-toss-dice-restore.test.ts",
      kind: "tossDiceHandDiscard",
      required: [
        "categoryDice",
        "categoryHandes",
        "lastDiceResults).toEqual([])",
        'eventName: "diceTossed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-confiscation-lp-cost-discard.test.ts",
      kind: "lpCostHandDiscard",
      required: [
        "category: 0x80",
        "lifePointCostPaid",
        "eventValue: 1000",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        'eventName: "discarded"',
        "duelReason.effect | duelReason.discard",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-core-discard-banish.test.ts",
      kind: "targetBanishDiscardCost",
      required: [
        "category: 0x4",
        'eventName: "discarded"',
        'eventName: "banished"',
        'location: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dian-keto-direct-recover.test.ts",
      kind: "directRecover",
      required: [
        "category: 0x100000",
        "targetParam: 1000",
        "targetPlayer: 0",
        'eventName: "recoveredLifePoints"',
        "lifePoints).toBe(7500)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-delinquent-duo-random-discard.test.ts",
      kind: "lpCostRandomHandDiscard",
      required: [
        "category: 0x80",
        "lifePointCostPaid",
        "randomCounter).toBe(1)",
        'eventName: "discarded"',
        "duelReason.effect | duelReason.discard",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dragged-down-mutual-discard-draw.test.ts",
      kind: "mutualHandDiscardDraw",
      required: [
        "category: 0x80",
        "category: 0x10000",
        'eventName: "discarded"',
        'eventName: "cardsDrawn"',
        "duelReason.effect | duelReason.discard",
        "confirmed 0",
        "confirmed 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-feather-phoenix-discard-grave-to-deck-top.test.ts",
      kind: "discardCostGraveToDeckTop",
      required: [
        "category: 0x10",
        'eventName: "discarded"',
        'eventName: "sentToDeck"',
        'location: "deck", controller: 0, sequence: 0',
        "getCards(restored.session.state, 0, \"deck\")",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-foolish-burial-deck-to-grave.test.ts",
      kind: "deckToGrave",
      required: [
        "category: 0x20",
        'eventName: "sentToGraveyard"',
        'location: "graveyard", controller: 0',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-branded-fusion-deck-material.test.ts",
      kind: "fusionDeckMaterials",
      required: [
        "category: 0x200",
        "category: 0x20",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, material!.uid]",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "special-summon-limit:non-fusion-extra",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-advanced-ritual-art-extra-material.test.ts",
      kind: "ritualDeckMaterials",
      required: [
        "category: 0x200",
        "parameter: 0x2",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([normalMaterialB!.uid, normalMaterialA!.uid])",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "duelReason.effect | duelReason.material | duelReason.ritual",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-fissure-min-attack-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "opponentLowAttack!.uid",
        "Fissure Low Attack Target",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-graceful-charity-draw-discard.test.ts",
      kind: "drawThenDiscard",
      required: [
        "category: 0x10000",
        "category: 0x80",
        "targetParam: 3",
        'eventName: "cardsDrawn"',
        'eventName: "discarded"',
        "duelReason.effect | duelReason.discard",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-forceful-sentry-hand-to-deck.test.ts",
      kind: "opponentHandToDeck",
      required: [
        "category: 0x10",
        "parameter: 2",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        'eventName: "sentToDeck"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-giant-trunade-group-to-hand.test.ts",
      kind: "groupToHand",
      required: [
        "category: 0x8",
        "sortedUids([",
        'eventName: "sentToHand"',
        'location: "hand"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-harpies-feather-duster-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
        'location: "spellTrapZone"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-hammer-shot-max-attack-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "ownHighAttack!.uid",
        "Hammer Shot Own High Attack Target",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-hazy-pillar-overlay-attach.test.ts",
      kind: "overlayAttach",
      required: [
        "operationInfos ?? []",
        'location: "overlay"',
        "overlayUids: [hazyMaterial!.uid]",
        "reasonCardUid: pillar!.uid",
        "reasonEffectId: 3",
        'eventName === "detachedMaterial"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-wizard-buster-self-equip.test.ts",
      kind: "selfEquipFromHand",
      required: [
        "category: 0x40000",
        'eventName: "equipped"',
        "equippedToUid: busterBlader!.uid",
        'location: "spellTrapZone"',
        "eventReasonEffectId: 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-heavy-storm-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "sortedUids([ownBackrow!.uid, opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-jar-greed-trap-draw.test.ts",
      kind: "trapDraw",
      required: [
        "category: 0x10000",
        "targetParam: 1",
        "targetPlayer: 0",
        'eventName: "cardsDrawn"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      kind: "groupDestroy",
      required: [
        "effectLabel: 1",
        "effectLabel: 2",
        "category: 0x1",
        "sortedUids([opponentAttacker!.uid, opponentSecondAttacker!.uid])",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-lightning-vortex-discard-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "sortedUids([opponentFaceupAttack!.uid, opponentFaceupDefense!.uid])",
        'eventName: "discarded"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-armed-dragon-thunder-lv7-ignition-summon.test.ts",
      kind: "ignitionSelfGraveDeckSummon",
      required: [
        "restores LoadCardScript-backed ignition cost, self to-Graveyard, and Deck Special Summon",
        'Duel.LoadCardScript("c73879377.lua")',
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.SendtoGrave(c,REASON_EFFECT)>0",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        "category: 0x20",
        "category: 0x200",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-nobleman-crossout-banish-destroy.test.ts",
      kind: "targetDestroyRemove",
      required: [
        "category: 0x1",
        "category: 0x4",
        'eventName: "destroyed"',
        'eventName: "banished"',
        'location: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-soul-release-target-banish.test.ts",
      kind: "targetBanish",
      required: [
        "restores multiple targeted Graveyard monsters, then banishes only related targets",
        "Duel.SelectTarget(tp,s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,1,5,nil)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "g:Filter(Card.IsRelateToEffect,nil,e)",
        "Duel.Remove(sg,POS_FACEUP,REASON_EFFECT)",
        "category: 0x4",
        'eventName: "banished"',
        'location: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-monster-reincarnation-discard-to-hand.test.ts",
      kind: "targetToHandDiscardCost",
      required: [
        "category: 0x8",
        'eventName: "discarded"',
        'eventName: "sentToHand"',
        'location: "hand"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-offerings-skip-draw.test.ts",
      kind: "targetDestroySkipDraw",
      required: [
        "category: 0x1",
        'eventName: "destroyed"',
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 1 }])',
        "restoredSkip.restoreComplete",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-ookazi-direct-damage.test.ts",
      kind: "directDamage",
      required: [
        "category: 0x80000",
        "targetParam: 800",
        "targetPlayer: 1",
        'eventName: "damageDealt"',
        "lifePoints).toBe(7200)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-painful-choice-deck-split.test.ts",
      kind: "deckSplit",
      required: [
        "category: 0x8",
        "category: 0x20",
        'eventName: "confirmed"',
        'eventName: "sentToHand"',
        'eventName: "sentToGraveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-avarice-five-grave-shuffle-draw.test.ts",
      kind: "fiveGraveToDeckShuffleDraw",
      required: [
        "category: 0x10",
        "category: 0x10000",
        "count: 5",
        "parameter: 2",
        'eventName: "sentToDeck"',
        'eventName: "cardsDrawn"',
        "eventUids: graveCards.map((card) => card!.uid)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        "category: 0x10000",
        'eventName: "banished"',
        'eventName: "cardsDrawn"',
        "faceUp: false",
        "reason: 0x80",
        "host.messages).not.toContain",
      ],
    },
    { file: "test/lua-real-script-pot-greed-spell-draw.test.ts", kind: "spellDraw", required: ["category: 0x10000", "targetParam: 2", "targetPlayer: 0", 'eventName: "cardsDrawn"', "eventValue: 2", "host.messages).not.toContain"] },
    { file: "test/lua-real-script-gather-your-mind-oath-search.test.ts", kind: "searchOrExcavate", required: ["e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)", "return c:IsCode(id) and c:IsAbleToHand()", "category: 0x8", 'eventName: "sentToHand"', 'eventName: "sentToHandConfirmed"', "getLuaRestoreLegalActions(restoredResolved, 0).some((action) => action.type === \"activateEffect\" && action.uid === searchedGather.uid)).toBe(false)", "host.messages).not.toContain"] },
    { file: "test/lua-real-script-kotetsu-flip-equip-search.test.ts", kind: "searchOrExcavate", required: ["e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)", "return c:IsType(TYPE_EQUIP) and c:IsAbleToHand()", "operationInfos: [{ category: 0x8", 'eventName: "flipSummoned"', 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-cyber-egg-angel-summon-flip-special-search.test.ts", kind: "searchOrExcavate", required: ["e1:SetProperty(EFFECT_FLAG_DELAY)", "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)", "e3:SetCode(EVENT_SPSUMMON_SUCCESS)", "return ((c:IsSetCard(SET_MACHINE_ANGEL) and c:IsSpell()) or c:IsCode(95658967)) and c:IsAbleToHand()", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-lady-debug-summon-special-search.test.ts", kind: "searchOrExcavate", required: ["e1:SetProperty(EFFECT_FLAG_DELAY)", "e2:SetCode(EVENT_SPSUMMON_SUCCESS)", "return c:IsLevelBelow(3) and c:IsRace(RACE_CYBERSE) and c:IsAbleToHand()", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-majespecter-raccoon-summon-search-protection.test.ts", kind: "searchOrExcavate", required: ["e2:SetCode(EVENT_SUMMON_SUCCESS)", "e3:SetCode(EVENT_SPSUMMON_SUCCESS)", "return c:IsSetCard(SET_MAJESPECTER) and c:IsMonster() and c:IsAbleToHand()", 'luaValueDescriptor: "cannot-be-effect-target:opponent"', 'luaValueDescriptor: "indestructible:opponent"', "targetUids).toEqual([vulnerable.uid])", 'eventName: "sentToHandConfirmed"'] },
    { file: "test/lua-real-script-speedroid-scratch-cost-search.test.ts", kind: "searchOrExcavate", required: ["e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)", "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,c)", "Duel.SendtoGrave(g,REASON_COST)", "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-megalith-ophiel-ritual-summon-search.test.ts", kind: "searchOrExcavate", required: ["e:GetHandler():IsRitualSummoned()", "Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)", "return c:IsSetCard(SET_MEGALITH) and c:IsMonster() and not c:IsCode(id) and c:IsAbleToHand()", "summonType: \"ritual\"", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-impcantation-candoll-hand-deck-summon-search.test.ts", kind: "searchOrExcavate", required: ["Duel.ShuffleHand(tp)", "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,tp,LOCATION_HAND|LOCATION_DECK)", "return c:IsRitualMonster() and c:IsAbleToHand()", "special-summon-limit:extra", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    { file: "test/lua-real-script-yellow-gadget-summon-special-search.test.ts", kind: "searchOrExcavate", required: ["local e2=e1:Clone()", "e2:SetCode(EVENT_SPSUMMON_SUCCESS)", "Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil)", "operationInfos: [{ category: 8", 'eventName: "sentToHandConfirmed"', "host.messages).not.toContain"] },
    {
      file: "test/lua-real-script-pot-of-duality-excavate.test.ts",
      kind: "searchOrExcavate",
      required: [
        "category: 0x8",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        "effect.sourceUid === pot!.uid && effect.code === 22",
        'action.type === "specialSummonProcedure"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        "category: 0x10000",
        "randomCounter).toBe(1)",
        'eventName: "cardsDrawn"',
        "faceUp: false",
        "drawDuelCards(restored.session.state, 0, 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-prosperity-excavate.test.ts",
      kind: "searchOrExcavate",
      required: [
        "category: 0x8",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        "drawDuelCards(restored.session.state, 0, 1",
        "effect.sourceUid === pot!.uid && effect.code === 82",
        "battleDamage[1]).toBe(500)",
        "host.messages).not.toContain",
      ],
    },
    { file: "test/lua-real-script-jar-avarice-grave-shuffle-draw.test.ts", kind: "fiveGraveToDeckShuffleDraw", required: ["e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)", "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,5,5,nil)", "Duel.GetOperatedGroup()", "Duel.BreakEffect()", "category: 0x10", "category: 0x10000", 'eventName: "sentToDeck"', 'eventName: "cardsDrawn"', "host.messages).not.toContain"] },
    {
      file: "test/lua-real-script-raigeki-group-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "sortedUids([opponentAttack!.uid, opponentDefense!.uid])",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-rage-kairyu-shin-zone-label.test.ts",
      kind: "targetDestroyDisableField",
      required: [
        "category: 0x1",
        'eventName: "destroyed"',
        "previousSequence: 2",
        "value: 1 << 18",
        "availableMonsterZoneCount(restored.session, 1, [])",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-reload-hand-to-deck-draw.test.ts",
      kind: "handToDeckDraw",
      required: [
        "category: 0x10",
        "category: 0x10000",
        "targetPlayer",
        'eventName: "sentToDeck"',
        'eventName: "cardsDrawn"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-reckless-greed-draw-skip.test.ts",
      kind: "trapDrawSkipDraw",
      required: [
        "category: 0x10000",
        "targetParam: 2",
        'eventName: "cardsDrawn"',
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 2 }])',
        "restoredSkip.restoreComplete",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-ryzeal-cross-grave-to-deck-bottom-draw.test.ts",
      kind: "graveToDeckBottomDraw",
      required: [
        "category: 0x10",
        "category: 0x10000",
        'eventName: "sentToDeck"',
        'eventName: "cardsDrawn"',
        "getCards(restored.session.state, 0, \"deck\")",
        "eventUids: [graveA!.uid, graveB!.uid]",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-saion-toss-coin-restore.test.ts",
      kind: "tossCoin",
      required: [
        "categoryCoin",
        "lastCoinResults).toEqual([])",
        'eventName: "coinTossed"',
        "saion disabled true",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-cynet-crosswipe-release-destroy.test.ts",
      kind: "targetDestroyReleaseCost",
      required: [
        "restores Cynet Crosswipe's Cyberse release cost and targeted destruction from CHAININFO",
        "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,s.spcheck,nil,dg)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "targetUids: [",
        'eventName: "released"',
        'eventName: "destroyed"',
        "duelReason.release | duelReason.cost",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shield-crush-target-destroy.test.ts",
      kind: "targetDestroy",
      required: [
        "restores Shield Crush's selected defense target and destroys it on resolution",
        "targetUids: [target!.uid]",
        'eventName: "destroyed"',
        'position: "faceDownDefense"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-chachaka-archer-ignition-spelltrap-destroy.test.ts",
      kind: "monsterIgnitionSpellTrapDestroy",
      required: [
        "restores its ignition target selection into GetFirstTarget Spell/Trap destruction",
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
        "Duel.GetFirstTarget()",
        "if tc:IsRelateToEffect(e) then",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-old-vindictive-magician-flip-target-destroy.test.ts",
      kind: "flipTargetDestroy",
      required: [
        "restores Old Vindictive Magician's Flip target, chain response window, and opponent monster destruction",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)",
        "Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)",
        "targetUids: [target.uid]",
        'eventName: "flipSummoned"',
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-igknight-paladin-pzone-search.test.ts",
      kind: "pzoneDestroySearch",
      required: [
        "destroys both Pendulum Zone cards to the Extra Deck before searching a FIRE Warrior",
        "category: 0x1",
        "category: 0x8",
        'location: "extraDeck"',
        'eventName: "destroyed"',
        'eventName: "sentToHandConfirmed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-smashing-ground-max-defense-destroy.test.ts",
      kind: "groupDestroy",
      required: [
        "category: 0x1",
        "opponentHighDefense!.uid",
        "Smashing Ground High Defense Target",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-soul-taker-destroy-recover.test.ts",
      kind: "targetDestroyRecover",
      required: [
        "category: 0x1",
        "category: 0x100000",
        'eventName: "destroyed"',
        'eventName: "recoveredLifePoints"',
        "lifePoints).toBe(9000)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-special-hurricane-discard-group-destroy.test.ts",
      kind: "discardCostSpecialSummonGroupDestroy",
      required: [
        "restores Special Hurricane's discard cost and non-targeting Special Summoned group destruction",
        "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)",
        "return c:IsSpecialSummoned()",
        "Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)",
        "eventName: \"discarded\"",
        "eventName: \"destroyed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-transmigration-prophecy-grave-shuffle.test.ts",
      kind: "crossPlayerGraveToDeckTrap",
      required: [
        "category: 0x10",
        'eventName: "sentToDeck"',
        "eventUids: [ownGrave!.uid, opponentGrave!.uid]",
        "controller: 1, location: \"deck\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-tribute-doomed-discard-destroy.test.ts",
      kind: "targetDestroyDiscardCost",
      required: [
        "category: 0x1",
        'eventName: "discarded"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    { file: "test/lua-real-script-xy-dragon-cannon-discard-spelltrap-destroy.test.ts", kind: "targetDestroyDiscardCost", required: ["Fusion.AddContactProc(c,s.contactfil,s.contactop,s.splimit)", "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)", "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_ONFIELD,1,1,nil)", "category: 0x1", "targetUids: [opponentFaceupSpell.uid]", 'eventName: "discarded"', 'eventName: "destroyed"', 'location: "graveyard"', "host.messages).not.toContain"] },
    {
      file: "test/lua-real-script-reinforcement-of-the-army-search.test.ts",
      kind: "searchOrExcavate",
      required: [
        "category: 0x8",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        'location: "hand", controller: 0',
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: OperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

export function countOperationKinds(fixtures: Array<{ kind: OperationKind }>): Record<OperationKind, number> {
  return fixtures.reduce<Record<OperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costBanishDraw: 0, costDiscardDraw: 0,
      crossPlayerGraveToDeckTrap: 0,
      controlReturn: 0,
      controlSwap: 0,
      banishedToGraveReturn: 0,
      banishedToHand: 0,
      banishedToDeckSelfSummon: 0,
      banishedToSpecialSummon: 0,
      chainNegateDiscardDestroy: 0,
      chainNegateDestroyDraw: 0,
      chainNegateColumnDestroy: 0,
      chainLinkedZoneDisable: 0,
      deckToGrave: 0,
      deckSplit: 0,
      discardCostSpecialSummonGroupDestroy: 0,
      discardCostGraveToDeckTop: 0,
      directDamage: 0,
      directRecover: 0,
      drawThenDiscard: 0,
      flipDeckSpecialSummon: 0,
      flipTargetDestroy: 0,
      fusionDeckMaterials: 0,
      groupDestroy: 0,
      groupToHand: 0,
      graveToDeckBottomDraw: 0,
      handDiscardDraw: 0,
      handToDeckDraw: 0,
      fiveGraveToDeckShuffleDraw: 0,
      ignitionSelfGraveDeckSummon: 0,
      lpCostHandDiscard: 0,
      lpCostRandomHandDiscard: 0,
      monsterIgnitionSpellTrapDestroy: 0,
      mutualHandDiscardDraw: 0,
      opponentHandToDeck: 0,
      overlayAttach: 0,
      positionSet: 0,
      pzoneDestroySearch: 0,
      releaseDamage: 0,
      ritualDeckMaterials: 0,
      searchOrExcavate: 0,
      selfEquipFromHand: 0,
      spellDraw: 0,
      trapDraw: 0,
      targetBanish: 0,
      targetBanishDiscardCost: 0,
      targetDestroy: 0,
      targetDestroyDiscardCost: 0,
      targetDestroyDisableField: 0,
      targetDestroyReleaseCost: 0,
      targetDestroyRemove: 0,
      targetDestroyRecover: 0,
      targetDestroySkipDraw: 0,
      targetToHandDiscardCost: 0,
      trapDrawSkipDraw: 0,
      tossCoin: 0,
      tossDiceHandDiscard: 0,
    },
  );
}
