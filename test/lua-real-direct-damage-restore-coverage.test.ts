import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const directDamageFixtureCount = 1;
const directDamageKindCounts = {
  lpConditionTargetParamDamage: 1,
} satisfies Record<DirectDamageKind, number>;
const directDamageSemanticVariantCounts = {
  meteorOfDestructionOpponentLpCondition: 1,
} satisfies Record<DirectDamageSemanticVariant, number>;

type DirectDamageKind = "lpConditionTargetParamDamage";
type DirectDamageSemanticVariant = "meteorOfDestructionOpponentLpCondition";

describe("Lua real direct damage restore coverage", () => {
  it("requires direct damage fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = directDamageFixtureFiles();
    expect(fixtures).toHaveLength(directDamageFixtureCount);

    const missing = fixtures
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires direct damage fixtures to prove operation info, LP changes, and damage events", () => {
    const fixtures = directDamageFixtureFiles();
    expect(fixtures).toHaveLength(directDamageFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x80000")
          || !text.includes('eventName: "damageDealt"')
          || !text.includes("lifePoints")
          || !text.includes('location: "graveyard"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps direct damage fixture kinds explicit", () => {
    expect(countDirectDamageKinds(directDamageFixtureFiles())).toEqual(directDamageKindCounts);
  });

  it("keeps named direct damage semantic variants explicit", () => {
    expect(countDirectDamageSemanticVariants(directDamageSemanticVariants())).toEqual(directDamageSemanticVariantCounts);

    const weak = directDamageSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function directDamageFixtureFiles(): Array<{ file: string; kind: DirectDamageKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-meteor-destruction-lp-condition-damage.test.ts",
      kind: "lpConditionTargetParamDamage",
      required: [
        'const meteorCode = "33767325"',
        "restores Meteor of Destruction's opponent-LP condition and target-param damage",
        "players[1].lifePoints = 3000",
        "players[1].lifePoints = 8000",
        "targetParam: 1000",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
  ];
}

function directDamageSemanticVariants(): Array<{ file: string; kind: DirectDamageSemanticVariant; required: string[] }> {
  return directDamageFixtureFiles().map(({ file, required }) => ({
    file,
    kind: "meteorOfDestructionOpponentLpCondition",
    required: [
      ...required,
      "Meteor of Destruction Chain Responder",
      "eventValue: 1000",
      "eventReasonCardUid: meteor!.uid",
      "meteor responder resolved",
    ],
  }));
}

function countDirectDamageKinds(fixtures: Array<{ kind: DirectDamageKind }>): Record<DirectDamageKind, number> {
  return fixtures.reduce<Record<DirectDamageKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      lpConditionTargetParamDamage: 0,
    },
  );
}

function countDirectDamageSemanticVariants(fixtures: Array<{ kind: DirectDamageSemanticVariant }>): Record<DirectDamageSemanticVariant, number> {
  return fixtures.reduce<Record<DirectDamageSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      meteorOfDestructionOpponentLpCondition: 0,
    },
  );
}
