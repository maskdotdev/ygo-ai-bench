import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DRAW_RECOVER_FIXTURE_COUNT = 10;
const drawRecoverKindCounts = {
  costBanishDraw: 2,
  costDiscardDraw: 1,
  drawRecoverOrDamage: 2,
  drawTrigger: 2,
  negateThenDraw: 1,
  overlayDetachDraw: 1,
  releaseDestroyDraw: 1,
} satisfies Record<DrawRecoverKind, number>;
const drawRecoverSemanticVariantCounts = {
  badReactionDrawThenDamage: 1,
  darkBribeNegateDestroyDraw: 1,
  geminiSparkReleaseDestroyDraw: 1,
  naturiaRagweedOpponentDrawTrigger: 1,
  potDesiresFaceDownDeckCostDraw: 1,
  potExtravaganceRandomExtraCostDrawLock: 1,
  shinobirdCraneSpiritSummonDraw: 1,
  tradeInLevel8DiscardDraw: 1,
  upstartGoblinDrawRecover: 1,
  xyzGiftOverlayDetachDraw: 1,
} satisfies Record<DrawRecoverSemanticVariant, number>;

type DrawRecoverKind = "costBanishDraw" | "costDiscardDraw" | "drawRecoverOrDamage" | "drawTrigger" | "negateThenDraw" | "overlayDetachDraw" | "releaseDestroyDraw";

type DrawRecoverSemanticVariant =
  | "badReactionDrawThenDamage"
  | "darkBribeNegateDestroyDraw"
  | "geminiSparkReleaseDestroyDraw"
  | "naturiaRagweedOpponentDrawTrigger"
  | "potDesiresFaceDownDeckCostDraw"
  | "potExtravaganceRandomExtraCostDrawLock"
  | "shinobirdCraneSpiritSummonDraw"
  | "tradeInLevel8DiscardDraw"
  | "upstartGoblinDrawRecover"
  | "xyzGiftOverlayDetachDraw";

describe("Lua real draw and recover restore coverage", () => {
  it("requires draw/recover fixtures to assert clean Lua registry restore and restored event outcomes", () => {
    const files = drawRecoverFixtureFiles();
    expect(files).toHaveLength(DRAW_RECOVER_FIXTURE_COUNT);

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
          || !text.includes('eventName: "cardsDrawn"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps draw/recover fixture kinds explicit", () => {
    expect(countDrawRecoverKinds(drawRecoverFixtureFiles())).toEqual(drawRecoverKindCounts);
  });

  it("keeps named draw/recover semantic variants explicit", () => {
    expect(countDrawRecoverSemanticVariants(drawRecoverSemanticVariants())).toEqual(drawRecoverSemanticVariantCounts);

    const weak = drawRecoverSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function drawRecoverFixtureFiles(): Array<{
  file: string;
  kind: DrawRecoverKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "damageDealt"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x100000",
        "players[1].lifePoints).toBe(7000)",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "negateThenDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        "category: 65536",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        'recoveredLifePoints")).toEqual([])',
      ],
    },
    {
      file: "test/lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "releaseDestroyDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "released"',
        "category: 0x10000",
        "parameter: 1",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        "gemini spark responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 1",
        "targetParam: 2",
        "category: 0x10000",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 2",
        "category: 65536",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 65536",
        "randomCounter).toBe(1)",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "normalSummoned"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x10000",
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-trade-in-discard-draw.test.ts",
      kind: "costDiscardDraw",
      required: [
        'eventName: "discarded"',
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 2",
        "category: 0x10000",
        "duelReason.cost | duelReason.discard",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        "category: 0x10000",
        "category: 0x100000",
        'eventName: "recoveredLifePoints"',
        "players[1].lifePoints).toBe(9000)",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-xyz-gift-overlay-draw.test.ts",
      kind: "overlayDetachDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "detachedMaterial"',
        "category: 0x10000",
        "parameter: 2",
        "overlayUids: []",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DrawRecoverKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDrawRecoverKinds(fixtures: Array<{ kind: DrawRecoverKind }>): Record<DrawRecoverKind, number> {
  return fixtures.reduce<Record<DrawRecoverKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costBanishDraw: 0,
      costDiscardDraw: 0,
      drawRecoverOrDamage: 0,
      drawTrigger: 0,
      negateThenDraw: 0,
      overlayDetachDraw: 0,
      releaseDestroyDraw: 0,
    },
  );
}

function drawRecoverSemanticVariants(): Array<{
  file: string;
  kind: DrawRecoverSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "badReactionDrawThenDamage",
      required: [
        'const badReactionCode = "40633297"',
        "restores Bad Reaction to Simochi and converts Upstart Goblin recovery into damage",
        "targetRange: [0, 1]",
        "eventName: \"cardsDrawn\"",
        "eventName: \"damageDealt\"",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "darkBribeNegateDestroyDraw",
      required: [
        'const darkBribeCode = "77538567"',
        "restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell",
        "category: 0x10000000",
        "eventName: \"chainNegated\"",
        "eventName: \"chainDisabled\"",
        "eventName === \"recoveredLifePoints\")).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "geminiSparkReleaseDestroyDraw",
      required: [
        'const sparkCode = "33846209"',
        "restores its Gemini release cost, target destruction, and draw",
        "eventName: \"released\"",
        "eventName: \"destroyed\"",
        "eventName: \"cardsDrawn\"",
        "gemini spark responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      kind: "naturiaRagweedOpponentDrawTrigger",
      required: [
        'const ragweedCode = "87649699"',
        "restores Naturia Ragweed's opponent-draw trigger, self cost, and CHAININFO draw count",
        "eventUids: [opponentDrawn!.uid, opponentDrawnSecond!.uid]",
        "targetParam: 2",
        "targetPlayer: 1",
        "eventReasonCardUid: giftOfGreed!.uid",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "potDesiresFaceDownDeckCostDraw",
      required: [
        'const potCode = "35261759"',
        "restores Pot of Desires' face-down banished deck cost and draw operation",
        "costUids).toHaveLength(10)",
        "position: \"faceDownDefense\"",
        "eventReason: duelReason.cost",
        "eventUids: drawUids",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "potExtravaganceRandomExtraCostDrawLock",
      required: [
        'const potCode = "49238328"',
        "restores Pot of Extravagance's random Extra Deck cost and draw lock",
        "randomCounter).toBe(1)",
        "eventUids.every((uid) => originalExtraUids.includes(uid))",
        "code === 25",
        "drawDuelCards(restored.session.state, 0, 1, \"Blocked effect draw\")).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "shinobirdCraneSpiritSummonDraw",
      required: [
        'const craneCode = "66815913"',
        "restores its field trigger when another Spirit monster is Summoned and draws 1 card",
        'eventName": "normalSummoned"',
        "targetParam: 1",
        "eventReasonCardUid: crane!.uid",
        "shinobird crane responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-trade-in-discard-draw.test.ts",
      kind: "tradeInLevel8DiscardDraw",
      required: [
        'const tradeInCode = "38120068"',
        "restores Trade-In's Level 8 discard cost, target-player draw metadata, and draw-two resolution",
        "Duel.DiscardHand(tp,s.filter,1,1,REASON_COST|REASON_DISCARD)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"discarded\"",
        "eventName: \"cardsDrawn\"",
        "trade-in responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      kind: "upstartGoblinDrawRecover",
      required: [
        'const upstartCode = "70368879"',
        "restores Upstart Goblin's draw/recover operation info and resolves both effects",
        "category: 1048576",
        "eventName: \"recoveredLifePoints\"",
        "players[1].lifePoints).toBe(9000)",
        "upstart goblin responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-xyz-gift-overlay-draw.test.ts",
      kind: "xyzGiftOverlayDetachDraw",
      required: [
        'const xyzGiftCode = "72355441"',
        "restores Xyz Gift after detaching two Xyz materials and drawing two cards",
        'eventName: "detachedMaterial"',
        "eventUids: [secondDraw.uid, firstDraw.uid]",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DrawRecoverSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDrawRecoverSemanticVariants(fixtures: Array<{ kind: DrawRecoverSemanticVariant }>): Record<DrawRecoverSemanticVariant, number> {
  return fixtures.reduce<Record<DrawRecoverSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      badReactionDrawThenDamage: 0,
      darkBribeNegateDestroyDraw: 0,
      geminiSparkReleaseDestroyDraw: 0,
      naturiaRagweedOpponentDrawTrigger: 0,
      potDesiresFaceDownDeckCostDraw: 0,
      potExtravaganceRandomExtraCostDrawLock: 0,
      shinobirdCraneSpiritSummonDraw: 0,
      tradeInLevel8DiscardDraw: 0,
      upstartGoblinDrawRecover: 0,
      xyzGiftOverlayDetachDraw: 0,
    },
  );
}
