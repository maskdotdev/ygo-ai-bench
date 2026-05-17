import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const operationFixtureCount = 51;
const summonTriggerOperationFixtureCount = 9;
const operationKindCounts = {
  costBanishDraw: 2,
  crossPlayerGraveToDeckTrap: 1,
  controlReturn: 1,
  controlSwap: 1,
  banishedToGraveReturn: 1,
  banishedToHand: 1,
  banishedToDeckSelfSummon: 1,
  banishedToSpecialSummon: 1,
  deckToGrave: 1,
  deckSplit: 1,
  discardCostGraveToDeckTop: 1,
  directDamage: 1,
  directRecover: 1,
  drawThenDiscard: 1,
  groupDestroy: 9,
  groupToHand: 1,
  graveToDeckBottomDraw: 1,
  handDiscardDraw: 1,
  handToDeckDraw: 1,
  fiveGraveToDeckShuffleDraw: 1,
  lpCostHandDiscard: 1,
  lpCostRandomHandDiscard: 1,
  mutualHandDiscardDraw: 1,
  opponentHandToDeck: 1,
  overlayAttach: 1,
  positionSet: 1,
  releaseDamage: 1,
  searchOrExcavate: 3,
  selfEquipFromHand: 1,
  spellDraw: 1,
  trapDraw: 1,
  targetBanishDiscardCost: 1,
  targetDestroyDiscardCost: 1,
  targetDestroyRemove: 1,
  targetDestroyRecover: 1,
  targetDestroySkipDraw: 1,
  targetToHandDiscardCost: 1,
  trapDrawSkipDraw: 1,
  tossCoin: 1,
  tossDiceHandDiscard: 1,
} satisfies Record<OperationKind, number>;
const summonTriggerOperationKindCounts = {
  summonDraw: 1,
  summonMassDestroy: 1,
  summonSearch: 3,
  summonSearchSelfSummon: 1,
  summonToDeck: 1,
  summonToHandBounce: 2,
} satisfies Record<SummonTriggerOperationKind, number>;

type OperationKind =
  | "costBanishDraw"
  | "crossPlayerGraveToDeckTrap"
  | "controlReturn"
  | "controlSwap"
  | "banishedToGraveReturn"
  | "banishedToHand"
  | "banishedToDeckSelfSummon"
  | "banishedToSpecialSummon"
  | "deckToGrave"
  | "deckSplit"
  | "discardCostGraveToDeckTop"
  | "directDamage"
  | "directRecover"
  | "drawThenDiscard"
  | "groupDestroy"
  | "groupToHand"
  | "graveToDeckBottomDraw"
  | "handDiscardDraw"
  | "handToDeckDraw"
  | "fiveGraveToDeckShuffleDraw"
  | "lpCostHandDiscard"
  | "lpCostRandomHandDiscard"
  | "mutualHandDiscardDraw"
  | "opponentHandToDeck"
  | "overlayAttach"
  | "positionSet"
  | "releaseDamage"
  | "searchOrExcavate"
  | "selfEquipFromHand"
  | "spellDraw"
  | "trapDraw"
  | "targetBanishDiscardCost"
  | "targetDestroyDiscardCost"
  | "targetDestroyRemove"
  | "targetDestroyRecover"
  | "targetDestroySkipDraw"
  | "targetToHandDiscardCost"
  | "trapDrawSkipDraw"
  | "tossCoin"
  | "tossDiceHandDiscard";

type SummonTriggerOperationKind =
  | "summonDraw"
  | "summonMassDestroy"
  | "summonSearch"
  | "summonSearchSelfSummon"
  | "summonToDeck"
  | "summonToHandBounce";

describe("Lua real operation restore coverage", () => {
  it("requires representative simple spell operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = operationFixtureFiles();
    expect(files).toHaveLength(operationFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps simple operation fixture kinds explicit", () => {
    expect(countOperationKinds(operationFixtureFiles())).toEqual(operationKindCounts);
  });

  it("requires summon-trigger operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = summonTriggerOperationFixtureFiles();
    expect(files).toHaveLength(summonTriggerOperationFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon-trigger operation fixture kinds explicit", () => {
    expect(countSummonTriggerOperationKinds(summonTriggerOperationFixtureFiles())).toEqual(summonTriggerOperationKindCounts);
  });
});

function operationFixtureFiles(): Array<{
  file: string;
  kind: OperationKind;
  required: string[];
}> {
  return ([
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
    {
      file: "test/lua-real-script-pot-greed-spell-draw.test.ts",
      kind: "spellDraw",
      required: [
        "category: 0x10000",
        "targetParam: 2",
        "targetPlayer: 0",
        'eventName: "cardsDrawn"',
        "eventValue: 2",
        "host.messages).not.toContain",
      ],
    },
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

function summonTriggerOperationFixtureFiles(): Array<{
  file: string;
  kind: SummonTriggerOperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "summonDraw",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "cardsDrawn"',
        "category: 65536",
        "targetParam: 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "summonMassDestroy",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "destroyed"',
        "category: 0x1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "discarded"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredOpenWindow.missingRegistryKeys).toEqual([])",
        "restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 256",
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "summonSearchSelfSummon",
      required: [
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDraw.missingRegistryKeys).toEqual([])",
        "restoredDraw.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "specialSummoned"',
        'eventName: "sentToHand"',
        'eventName: "phaseStandby"',
        "category: 8",
        "category: 512",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "possibleOperationInfos",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "summonToDeck",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToDeck"',
        "category: 16",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonTriggerOperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countOperationKinds(fixtures: Array<{ kind: OperationKind }>): Record<OperationKind, number> {
  return fixtures.reduce<Record<OperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costBanishDraw: 0,
      crossPlayerGraveToDeckTrap: 0,
      controlReturn: 0,
      controlSwap: 0,
      banishedToGraveReturn: 0,
      banishedToHand: 0,
      banishedToDeckSelfSummon: 0,
      banishedToSpecialSummon: 0,
      deckToGrave: 0,
      deckSplit: 0,
      discardCostGraveToDeckTop: 0,
      directDamage: 0,
      directRecover: 0,
      drawThenDiscard: 0,
      groupDestroy: 0,
      groupToHand: 0,
      graveToDeckBottomDraw: 0,
      handDiscardDraw: 0,
      handToDeckDraw: 0,
      fiveGraveToDeckShuffleDraw: 0,
      lpCostHandDiscard: 0,
      lpCostRandomHandDiscard: 0,
      mutualHandDiscardDraw: 0,
      opponentHandToDeck: 0,
      overlayAttach: 0,
      positionSet: 0,
      releaseDamage: 0,
      searchOrExcavate: 0,
      selfEquipFromHand: 0,
      spellDraw: 0,
      trapDraw: 0,
      targetBanishDiscardCost: 0,
      targetDestroyDiscardCost: 0,
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

function countSummonTriggerOperationKinds(
  fixtures: Array<{ kind: SummonTriggerOperationKind }>,
): Record<SummonTriggerOperationKind, number> {
  return fixtures.reduce<Record<SummonTriggerOperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      summonDraw: 0,
      summonMassDestroy: 0,
      summonSearch: 0,
      summonSearchSelfSummon: 0,
      summonToDeck: 0,
      summonToHandBounce: 0,
    },
  );
}
