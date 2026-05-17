import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const directDamageFixtureCount = 6;
const directDamageKindCounts = {
  allPlayerDelayedDamage: 1,
  targetParamDamage: 4,
  lpConditionTargetParamDamage: 1,
} satisfies Record<DirectDamageKind, number>;
const directDamageSemanticVariantCounts = {
  finalFlameTargetParamDamage: 1,
  hinotamaTargetParamDamage: 1,
  meteorOfDestructionOpponentLpCondition: 1,
  ookaziTargetParamDamage: 1,
  sparksTargetParamDamage: 1,
  tremendousFireAllPlayerDelayedDamage: 1,
} satisfies Record<DirectDamageSemanticVariant, number>;

type DirectDamageKind = "allPlayerDelayedDamage" | "lpConditionTargetParamDamage" | "targetParamDamage";
type DirectDamageSemanticVariant =
  | "finalFlameTargetParamDamage"
  | "hinotamaTargetParamDamage"
  | "meteorOfDestructionOpponentLpCondition"
  | "ookaziTargetParamDamage"
  | "sparksTargetParamDamage"
  | "tremendousFireAllPlayerDelayedDamage";

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
      file: "test/lua-real-script-final-flame-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const finalFlameCode = "73134081"',
        "restores Final Flame's target-param damage operation",
        "targetParam: 600",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7400)",
      ],
    },
    {
      file: "test/lua-real-script-hinotama-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const hinotamaCode = "46130346"',
        "restores Hinotama's target-param damage operation",
        "targetParam: 500",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
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
    {
      file: "test/lua-real-script-sparks-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const sparksCode = "76103675"',
        "restores Sparks' target-param damage operation",
        "targetParam: 200",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7800)",
      ],
    },
    {
      file: "test/lua-real-script-ookazi-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const ookaziCode = "19523799"',
        "restores Ookazi's player-targeted damage operation",
        "targetParam: 800",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "test/lua-real-script-tremendous-fire-delayed-damage.test.ts",
      kind: "allPlayerDelayedDamage",
      required: [
        'const tremendousFireCode = "46918794"',
        "restores Tremendous Fire's all-player delayed damage operation",
        "parameter: 500",
        "player: 0",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
  ];
}

function directDamageSemanticVariants(): Array<{ file: string; kind: DirectDamageSemanticVariant; required: string[] }> {
  const variants: Array<{ file: string; kind: DirectDamageSemanticVariant; required: string[] }> = [
    {
      file: "test/lua-real-script-final-flame-direct-damage.test.ts",
      kind: "finalFlameTargetParamDamage",
      required: [
        "Final Flame Chain Responder",
        "eventValue: 600",
        "eventReasonCardUid: finalFlame!.uid",
        "final flame responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-hinotama-direct-damage.test.ts",
      kind: "hinotamaTargetParamDamage",
      required: [
        "Hinotama Chain Responder",
        "eventValue: 500",
        "eventReasonCardUid: hinotama!.uid",
        "hinotama responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-meteor-destruction-lp-condition-damage.test.ts",
      kind: "meteorOfDestructionOpponentLpCondition",
      required: [
        "Meteor of Destruction Chain Responder",
        "eventValue: 1000",
        "eventReasonCardUid: meteor!.uid",
        "meteor responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-sparks-direct-damage.test.ts",
      kind: "sparksTargetParamDamage",
      required: [
        "Sparks Chain Responder",
        "eventValue: 200",
        "eventReasonCardUid: sparks!.uid",
        "sparks responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-ookazi-direct-damage.test.ts",
      kind: "ookaziTargetParamDamage",
      required: [
        "Ookazi Chain Responder",
        "eventValue: 800",
        "eventReasonCardUid: ookazi!.uid",
        "ookazi responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-tremendous-fire-delayed-damage.test.ts",
      kind: "tremendousFireAllPlayerDelayedDamage",
      required: [
        "Tremendous Fire Chain Responder",
        "eventValue: 1000",
        "eventValue: 500",
        "eventReasonCardUid: tremendousFire!.uid",
        "tremendous fire responder resolved",
      ],
    },
  ];

  return variants.map(({ file, kind, required }) => ({
    file,
    kind,
    required: [
      ...directDamageFixtureFiles().find((fixture) => fixture.file === file)!.required,
      ...required,
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
      allPlayerDelayedDamage: 0,
      targetParamDamage: 0,
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
      finalFlameTargetParamDamage: 0,
      hinotamaTargetParamDamage: 0,
      meteorOfDestructionOpponentLpCondition: 0,
      ookaziTargetParamDamage: 0,
      sparksTargetParamDamage: 0,
      tremendousFireAllPlayerDelayedDamage: 0,
    },
  );
}
