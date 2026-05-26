import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonNegationFixtureCount = 6;
const summonNegationKindCounts = {
  allSummonTypesCostNegate: 2,
  inherentSpecialSummonNegate: 2,
  specialSummonNegatePhaseSkip: 1,
  specialSummonNegateReleaseCost: 1,
} satisfies Record<SummonNegationKind, number>;
const summonNegationSemanticVariantCounts = {
  blackHornOpponentOnlySpecialSummonNegate: 1,
  grandHornOpponentTurnSummonNegateDrawPhaseSkip: 1,
  hornOfHeavenReleaseCostSummonNegate: 1,
  solemnJudgmentAllSummonTypesCostNegate: 1,
  solemnStrikeInherentSpecialSummonNegate: 1,
  solemnWarningAllSummonTypesCostNegate: 1,
} satisfies Record<SummonNegationSemanticVariant, number>;

type SummonNegationKind =
  | "allSummonTypesCostNegate"
  | "inherentSpecialSummonNegate"
  | "specialSummonNegatePhaseSkip"
  | "specialSummonNegateReleaseCost";
type SummonNegationSemanticVariant =
  | "blackHornOpponentOnlySpecialSummonNegate"
  | "grandHornOpponentTurnSummonNegateDrawPhaseSkip"
  | "hornOfHeavenReleaseCostSummonNegate"
  | "solemnJudgmentAllSummonTypesCostNegate"
  | "solemnStrikeInherentSpecialSummonNegate"
  | "solemnWarningAllSummonTypesCostNegate";

describe("Lua real summon-negation restore coverage", () => {
  it("requires representative summon-negation fixtures to assert grouped legal actions and clean Lua restore", () => {
    const fixtures = realScriptSummonNegationFixtures();
    expect(fixtures).toHaveLength(summonNegationFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative summon-negation fixtures to prove restored summon-attempt chain metadata and success cleanup", () => {
    const fixtures = realScriptSummonNegationFixtures();
    expect(fixtures).toHaveLength(summonNegationFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return ![
          '"category": 32768',
          '"category": 1',
          'location: "graveyard"',
          "eventHistory.filter",
          "host.messages).not.toContain",
          ...fixture.requiredSnippets,
        ].every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });

  it("keeps split summon-negation continuation fixtures under restore coverage ownership", () => {
    const fixtures = realScriptSummonNegationContinuationFixtures();
    expect(fixtures).toHaveLength(2);

    const weak = fixtures
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return ![
          "restoreDuelWithLuaScripts",
          "applyLuaRestoreResponse",
          "getLuaRestoreLegalActions",
          "getLuaRestoreLegalActionGroups",
          "getGroupedDuelLegalActions",
          "flatMap((group) => group.actions)",
          "restoreComplete",
          'incompleteReasons.join("; ")',
          "missingRegistryKeys).toEqual([])",
          "missingChainLimitRegistryKeys).toEqual([])",
          "eventHistory",
          "operationInfos",
          'location: "graveyard"',
          'eventName: "chainNegated"',
          'eventName: "chainDisabled"',
          'eventName: "lifePointCostPaid"',
          "host.messages).not.toContain",
        ].every((snippet) => hasCoverageSnippet(text, snippet));
      });

    expect(weak).toEqual([]);
  });

  it("keeps summon-negation fixture kinds explicit", () => {
    expect(countSummonNegationKinds(realScriptSummonNegationFixtures())).toEqual(summonNegationKindCounts);
  });

  it("keeps named summon-negation semantic variants explicit", () => {
    expect(countSummonNegationSemanticVariants(summonNegationSemanticVariants())).toEqual(
      summonNegationSemanticVariantCounts,
    );

    const weak = summonNegationSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptSummonNegationFixtures(): Array<{
  file: string;
  kind: SummonNegationKind;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-solemn-judgment-summon-negate.test.ts",
      kind: "allSummonTypesCostNegate",
      requiredSnippets: [
        'eventName: "normalSummoning"',
        'eventName: "flipSummoning"',
        'eventName: "specialSummoning"',
        'eventName: "normalSummonNegated"',
        'eventName: "flipSummonNegated"',
        'eventName: "specialSummonNegated"',
        'eventName === "normalSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName === "flipSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName: "lifePointCostPaid"',
        "eventValue: 4000",
      ],
    },
    {
      file: "test/lua-real-script-solemn-warning-special-summon-effect-negate.test.ts",
      kind: "allSummonTypesCostNegate",
      requiredSnippets: [
        'eventName: "normalSummoning"',
        'eventName: "flipSummoning"',
        'eventName: "specialSummoning"',
        'eventName: "normalSummonNegated"',
        'eventName: "flipSummonNegated"',
        'eventName: "specialSummonNegated"',
        'eventName === "normalSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName === "flipSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName: "lifePointCostPaid"',
        "eventValue: 2000",
      ],
    },
    {
      file: "test/lua-real-script-solemn-strike-special-summon-negate.test.ts",
      kind: "inherentSpecialSummonNegate",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName: "lifePointCostPaid"',
        "eventValue: 1500",
      ],
    },
    {
      file: "test/lua-real-script-black-horn-special-summon-negate.test.ts",
      kind: "inherentSpecialSummonNegate",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        "eventReasonPlayer: 0",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-grand-horn-special-summon-negate.test.ts",
      kind: "specialSummonNegatePhaseSkip",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName: "cardsDrawn"',
        'skippedPhases).toEqual([{ player: 0, phase: "main1", remaining: 1 }])',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-horn-of-heaven-release-cost-negate.test.ts",
      kind: "specialSummonNegateReleaseCost",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([])',
        'eventName: "released"',
        "duelReason.release",
        "duelReason.cost",
        "previousLocation: \"monsterZone\"",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonNegationKind;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptSummonNegationContinuationFixtures(): string[] {
  return [
    "test/lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "test/lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
  ].sort();
}

function summonNegationSemanticVariants(): Array<{
  file: string;
  kind: SummonNegationSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-black-horn-special-summon-negate.test.ts",
      kind: "blackHornOpponentOnlySpecialSummonNegate",
      requiredSnippets: [
        'const hornCode = "50323155"',
        "restores Black Horn of Heaven's opponent-only Special Summon negation and cleanup",
        'eventName: "specialSummonNegated"',
      ],
    },
    {
      file: "test/lua-real-script-grand-horn-special-summon-negate.test.ts",
      kind: "grandHornOpponentTurnSummonNegateDrawPhaseSkip",
      requiredSnippets: [
        'const hornCode = "1637760"',
        "restores Grand Horn's opponent-turn Special Summon negation, draw, and current-phase skip",
        'eventName: "cardsDrawn"',
        'skippedPhases).toEqual([{ player: 0, phase: "main1", remaining: 1 }])',
      ],
    },
    {
      file: "test/lua-real-script-horn-of-heaven-release-cost-negate.test.ts",
      kind: "hornOfHeavenReleaseCostSummonNegate",
      requiredSnippets: [
        'const hornCode = "98069388"',
        "restores Horn of Heaven's release cost, Special Summon negation, and cleanup",
        'eventName: "released"',
      ],
    },
    {
      file: "test/lua-real-script-solemn-judgment-summon-negate.test.ts",
      kind: "solemnJudgmentAllSummonTypesCostNegate",
      requiredSnippets: [
        'const solemnCode = "41420027"',
        "restores Solemn Judgment's summon-attempt activation, LP-half cost, and negated Normal Summon cleanup",
        "restores Solemn Judgment's cloned Flip Summon-attempt activation and cleanup",
        "restores Solemn Judgment's cloned Special Summon-attempt activation and cleanup",
      ],
    },
    {
      file: "test/lua-real-script-solemn-strike-special-summon-negate.test.ts",
      kind: "solemnStrikeInherentSpecialSummonNegate",
      requiredSnippets: [
        'const strikeCode = "40605147"',
        "restores Solemn Strike's Special Summon negation, fixed LP cost, and destroyed-event cleanup",
        'eventName: "specialSummonNegated"',
      ],
    },
    {
      file: "test/lua-real-script-solemn-warning-special-summon-effect-negate.test.ts",
      kind: "solemnWarningAllSummonTypesCostNegate",
      requiredSnippets: [
        'const warningCode = "84749824"',
        "restores Solemn Warning's summon-attempt activation, fixed LP cost, and negated Normal Summon cleanup",
        "restores Solemn Warning's cloned Special Summon-attempt activation and cleanup",
        "restores Solemn Warning's cloned Flip Summon-attempt activation and cleanup",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonNegationSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonNegationKinds(
  fixtures: Array<{ kind: SummonNegationKind }>,
): Record<SummonNegationKind, number> {
  return fixtures.reduce<Record<SummonNegationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      allSummonTypesCostNegate: 0,
      inherentSpecialSummonNegate: 0,
      specialSummonNegatePhaseSkip: 0,
      specialSummonNegateReleaseCost: 0,
    },
  );
}

function countSummonNegationSemanticVariants(
  fixtures: Array<{ kind: SummonNegationSemanticVariant }>,
): Record<SummonNegationSemanticVariant, number> {
  return fixtures.reduce<Record<SummonNegationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      blackHornOpponentOnlySpecialSummonNegate: 0,
      grandHornOpponentTurnSummonNegateDrawPhaseSkip: 0,
      hornOfHeavenReleaseCostSummonNegate: 0,
      solemnJudgmentAllSummonTypesCostNegate: 0,
      solemnStrikeInherentSpecialSummonNegate: 0,
      solemnWarningAllSummonTypesCostNegate: 0,
    },
  );
}
