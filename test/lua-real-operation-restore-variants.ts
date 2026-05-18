export const groupDestroyOperationVariantCounts = {
  darkHoleAllMonsters: 1,
  fissureMinAttack: 1,
  harpiesFeatherDusterBackrow: 1,
  hammerShotMaxAttack: 1,
  heavyStormAllBackrow: 1,
  lightningStormAttackPosition: 1,
  lightningStormSpellTrap: 1,
  lightningVortexFaceUpOpponents: 1,
  raigekiOpponentMonsters: 1,
  smashingGroundMaxDefense: 1,
} satisfies Record<GroupDestroyOperationVariant, number>;
export const potAndSearchOperationVariantCounts = {
  gatherYourMindOathSearch: 1,
  potDesiresFaceDownBanishDraw: 1,
  potDualitySearchSummonLock: 1,
  potExtravaganceRandomCostDrawLock: 1,
  potProsperitySearchDrawLockDamage: 1,
  reinforcementWarriorSearch: 1,
} satisfies Record<PotAndSearchOperationVariant, number>;
export const chainNegationOperationVariantCounts = {
  brokenLineColumnNegateDestroy: 1,
  darkBribeNegateDestroyDraw: 1,
  magicJammerDiscardNegateDestroy: 1,
  pitknightLinkedZoneDisable: 1,
} satisfies Record<ChainNegationOperationVariant, number>;

export type GroupDestroyOperationVariant =
  | "darkHoleAllMonsters"
  | "fissureMinAttack"
  | "harpiesFeatherDusterBackrow"
  | "hammerShotMaxAttack"
  | "heavyStormAllBackrow"
  | "lightningStormAttackPosition"
  | "lightningStormSpellTrap"
  | "lightningVortexFaceUpOpponents"
  | "raigekiOpponentMonsters"
  | "smashingGroundMaxDefense";
export type PotAndSearchOperationVariant =
  | "gatherYourMindOathSearch"
  | "potDesiresFaceDownBanishDraw"
  | "potDualitySearchSummonLock"
  | "potExtravaganceRandomCostDrawLock"
  | "potProsperitySearchDrawLockDamage"
  | "reinforcementWarriorSearch";
export type ChainNegationOperationVariant =
  | "brokenLineColumnNegateDestroy"
  | "darkBribeNegateDestroyDraw"
  | "magicJammerDiscardNegateDestroy"
  | "pitknightLinkedZoneDisable";

export function groupDestroyOperationVariants(): Array<{ file: string; kind: GroupDestroyOperationVariant; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-dark-hole-group-destroy.test.ts",
      kind: "darkHoleAllMonsters",
      required: [
        "restores Dark Hole's non-targeting all-monster group destroy",
        "sortedUids([ownMonster!.uid, opponentAttack!.uid, opponentDefense!.uid])",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-fissure-min-attack-destroy.test.ts",
      kind: "fissureMinAttack",
      required: [
        "restores Fissure's minimum-ATK opponent monster destroy operation",
        "opponentLowAttack!.uid",
        "Fissure Low Attack Target",
      ],
    },
    {
      file: "test/lua-real-script-harpies-feather-duster-group-destroy.test.ts",
      kind: "harpiesFeatherDusterBackrow",
      required: [
        "restores Harpie's Feather Duster opponent Spell/Trap group destroy",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
        'location: "spellTrapZone"',
      ],
    },
    {
      file: "test/lua-real-script-hammer-shot-max-attack-destroy.test.ts",
      kind: "hammerShotMaxAttack",
      required: [
        "restores Hammer Shot's maximum-ATK all-field attack-position destroy operation",
        "ownHighAttack!.uid",
        "Hammer Shot Own High Attack Target",
      ],
    },
    {
      file: "test/lua-real-script-heavy-storm-group-destroy.test.ts",
      kind: "heavyStormAllBackrow",
      required: [
        "restores Heavy Storm's non-targeting all-field Spell/Trap group destroy",
        "sortedUids([ownBackrow!.uid, opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      kind: "lightningStormAttackPosition",
      required: [
        "restores Lightning Storm's selected attack-position monster destroy mode",
        "effectLabel: 1",
        "sortedUids([opponentAttacker!.uid, opponentSecondAttacker!.uid])",
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      kind: "lightningStormSpellTrap",
      required: [
        "restores Lightning Storm's selected Spell/Trap destroy mode",
        "effectLabel: 2",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
      ],
    },
    {
      file: "test/lua-real-script-lightning-vortex-discard-group-destroy.test.ts",
      kind: "lightningVortexFaceUpOpponents",
      required: [
        "restores Lightning Vortex's discard cost and face-up opponent monster group destroy",
        "sortedUids([opponentFaceupAttack!.uid, opponentFaceupDefense!.uid])",
        'eventName: "discarded"',
      ],
    },
    {
      file: "test/lua-real-script-raigeki-group-destroy.test.ts",
      kind: "raigekiOpponentMonsters",
      required: [
        "restores Raigeki's non-targeting opponent monster group destroy",
        "sortedUids([opponentAttack!.uid, opponentDefense!.uid])",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-smashing-ground-max-defense-destroy.test.ts",
      kind: "smashingGroundMaxDefense",
      required: [
        "restores Smashing Ground's maximum-DEF opponent monster destroy operation",
        "opponentHighDefense!.uid",
        "Smashing Ground High Defense Target",
      ],
    },
  ] satisfies Array<{ file: string; kind: GroupDestroyOperationVariant; required: string[] }>).sort((a, b) => a.kind.localeCompare(b.kind));
}

export function countGroupDestroyOperationVariants(fixtures: Array<{ kind: GroupDestroyOperationVariant }>): Record<GroupDestroyOperationVariant, number> {
  return fixtures.reduce<Record<GroupDestroyOperationVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      darkHoleAllMonsters: 0,
      fissureMinAttack: 0,
      harpiesFeatherDusterBackrow: 0,
      hammerShotMaxAttack: 0,
      heavyStormAllBackrow: 0,
      lightningStormAttackPosition: 0,
      lightningStormSpellTrap: 0,
      lightningVortexFaceUpOpponents: 0,
      raigekiOpponentMonsters: 0,
      smashingGroundMaxDefense: 0,
    },
  );
}

export function potAndSearchOperationVariants(): Array<{ file: string; kind: PotAndSearchOperationVariant; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-gather-your-mind-oath-search.test.ts",
      kind: "gatherYourMindOathSearch",
      required: [
        "restores its free-chain same-code Deck search, confirmation, and OATH count limit",
        "const gatherCode = \"7512044\"",
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "expect(restoredChain.host.messages).toEqual([`confirmed 1: ${gatherCode}`])",
        "action.uid === searchedGather.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "potDesiresFaceDownBanishDraw",
      required: [
        "restores Pot of Desires' face-down banished deck cost and draw operation",
        "const potCode = \"35261759\"",
        'eventName: "banished"',
        "faceUp: false",
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-duality-excavate.test.ts",
      kind: "potDualitySearchSummonLock",
      required: [
        "restores Pot of Duality's excavate search and Special Summon lock",
        "const potCode = \"98645731\"",
        "effect.sourceUid === pot!.uid && effect.code === 22",
        "getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === procedure!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "potExtravaganceRandomCostDrawLock",
      required: [
        "restores Pot of Extravagance's random Extra Deck cost and draw lock",
        "const potCode = \"49238328\"",
        "randomCounter).toBe(1)",
        "drawDuelCards(restored.session.state, 0, 1, \"Blocked effect draw\")).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-prosperity-excavate.test.ts",
      kind: "potProsperitySearchDrawLockDamage",
      required: [
        "restores Pot of Prosperity's Extra Deck cost, deck-top selection, draw lock, and damage change",
        "const potCode = \"84211599\"",
        "drawDuelCards(restored.session.state, 0, 1, \"Blocked prosperity draw\")).toBe(0)",
        "effect.sourceUid === pot!.uid && effect.code === 82",
        "battleDamage[1]).toBe(500)",
      ],
    },
    {
      file: "test/lua-real-script-reinforcement-of-the-army-search.test.ts",
      kind: "reinforcementWarriorSearch",
      required: [
        "restores Reinforcement of the Army's deck-search operation info and adds the Warrior to hand",
        "const reinforcementCode = \"32807846\"",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        "expect(restored.host.messages).toEqual([`confirmed 1: ${warriorCode}`])",
      ],
    },
  ] satisfies Array<{ file: string; kind: PotAndSearchOperationVariant; required: string[] }>).sort((a, b) => a.kind.localeCompare(b.kind));
}

export function countPotAndSearchOperationVariants(fixtures: Array<{ kind: PotAndSearchOperationVariant }>): Record<PotAndSearchOperationVariant, number> {
  return fixtures.reduce<Record<PotAndSearchOperationVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      gatherYourMindOathSearch: 0,
      potDesiresFaceDownBanishDraw: 0,
      potDualitySearchSummonLock: 0,
      potExtravaganceRandomCostDrawLock: 0,
      potProsperitySearchDrawLockDamage: 0,
      reinforcementWarriorSearch: 0,
    },
  );
}

export function chainNegationOperationVariants(): Array<{ file: string; kind: ChainNegationOperationVariant; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-broken-line-column-negate.test.ts",
      kind: "brokenLineColumnNegateDestroy",
      required: [
        "restores its bit.extract column check and suppresses the negated Spell activation",
        "const brokenLineCode = \"88086137\"",
        "bit.extract column check",
        "{ category: 0x10000000, targetUids: [upstart.uid], count: 1, player: 0, parameter: 0 }",
        "eventName: \"chainNegated\"",
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "darkBribeNegateDestroyDraw",
      required: [
        "restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell",
        "const darkBribeCode = \"77538567\"",
        "{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }",
        "eventName: \"cardsDrawn\"",
        "eventName: \"chainDisabled\"",
      ],
    },
    {
      file: "test/lua-real-script-magic-jammer-chain-negate.test.ts",
      kind: "magicJammerDiscardNegateDestroy",
      required: [
        "restores a Counter Trap response that discards, negates, destroys, and suppresses the Spell operation",
        "const magicJammerCode = \"77414722\"",
        "eventName: \"discarded\"",
        "{ category: 0x10000000, targetUids: [upstart!.uid], count: 1, player: 0, parameter: 0 }",
        "eventName: \"chainDisabled\"",
      ],
    },
    {
      file: "test/lua-real-script-pitknight-earlie-linked-chain-disable.test.ts",
      kind: "pitknightLinkedZoneDisable",
      required: [
        "restores its bit.extract linked-zone chain condition and disables the selected monster",
        "const pitknightCode = \"47759571\"",
        "bit.extract linked-zone chain condition",
        "targetUids: [starter.uid]",
        "currentAttack(restoredStarter, restoredPendingResolution.session.state)).toBe(0)",
      ],
    },
  ] satisfies Array<{ file: string; kind: ChainNegationOperationVariant; required: string[] }>).sort((a, b) => a.kind.localeCompare(b.kind));
}

export function countChainNegationOperationVariants(fixtures: Array<{ kind: ChainNegationOperationVariant }>): Record<ChainNegationOperationVariant, number> {
  return fixtures.reduce<Record<ChainNegationOperationVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      brokenLineColumnNegateDestroy: 0,
      darkBribeNegateDestroyDraw: 0,
      magicJammerDiscardNegateDestroy: 0,
      pitknightLinkedZoneDisable: 0,
    },
  );
}
