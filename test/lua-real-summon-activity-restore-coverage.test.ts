import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonActivityFixtureCount = 4;
const summonActivityKindCounts = {
  archetypeExtraNormalSummon: 1,
  genericExtraNormalSummon: 1,
  specialSummonOath: 1,
  spiritExtraNormalSummon: 1,
} satisfies Record<SummonActivityKind, number>;
const summonActivitySemanticVariantCounts = {
  constellarLeonisExtraConstellarNormalSummon: 1,
  doubleSummonSecondNormalSummonGrant: 1,
  nikitamaAdditionalSpiritNormalSummon: 1,
  thunderSeaHorseTemporarySpecialSummonOath: 1,
} satisfies Record<SummonActivitySemanticVariant, number>;

type SummonActivityKind =
  | "archetypeExtraNormalSummon"
  | "genericExtraNormalSummon"
  | "specialSummonOath"
  | "spiritExtraNormalSummon";
type SummonActivitySemanticVariant =
  | "constellarLeonisExtraConstellarNormalSummon"
  | "doubleSummonSecondNormalSummonGrant"
  | "nikitamaAdditionalSpiritNormalSummon"
  | "thunderSeaHorseTemporarySpecialSummonOath";

describe("Lua real summon activity restore coverage", () => {
  it("requires summon activity fixtures to assert clean restore and restored legal actions", () => {
    const files = summonActivityFixtureFiles();
    expect(files).toHaveLength(summonActivityFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon activity fixture kinds explicit", () => {
    expect(countSummonActivityKinds(summonActivityFixtureFiles())).toEqual(summonActivityKindCounts);
  });

  it("keeps named summon activity semantic variants explicit", () => {
    expect(countSummonActivitySemanticVariants(summonActivitySemanticVariants())).toEqual(
      summonActivitySemanticVariantCounts,
    );

    const weak = summonActivitySemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps summon activity fixtures script-gated and database-independent", () => {
    const weak = summonActivitySemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function summonActivityFixtureFiles(): Array<{
  file: string;
  kind: SummonActivityKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-constellar-leonis-extra-summon-count.test.ts",
      kind: "archetypeExtraNormalSummon",
      required: [
        "extra Constellar Normal Summon",
        "normalSummonAvailable).toBe(false)",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-double-summon-count-limit.test.ts",
      kind: "genericExtraNormalSummon",
      required: [
        "code: 28",
        "value: 2",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-nikitama-extra-spirit-summon.test.ts",
      kind: "spiritExtraNormalSummon",
      required: [
        "additional Spirit Normal Summon",
        "normalSummonAvailable).toBe(false)",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-oath.test.ts",
      kind: "specialSummonOath",
      required: [
        "sea horse can special locked false",
        "sea horse special locked 0",
        "sea horse can special after end true",
        "sea horse special after end 1",
        'action.type === "endTurn"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonActivityKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonActivityKinds(
  fixtures: Array<{ kind: SummonActivityKind }>,
): Record<SummonActivityKind, number> {
  return fixtures.reduce<Record<SummonActivityKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      archetypeExtraNormalSummon: 0,
      genericExtraNormalSummon: 0,
      specialSummonOath: 0,
      spiritExtraNormalSummon: 0,
    },
  );
}

function summonActivitySemanticVariants(): Array<{
  file: string;
  kind: SummonActivitySemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-constellar-leonis-extra-summon-count.test.ts",
      kind: "constellarLeonisExtraConstellarNormalSummon",
      required: [
        'const leonisCode = "17129783"',
        "restores Leonis's extra Constellar Normal Summon after the regular summon is spent",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-double-summon-count-limit.test.ts",
      kind: "doubleSummonSecondNormalSummonGrant",
      required: [
        'const doubleSummonCode = "43422537"',
        "lets official Double Summon grant a second Normal Summon legal action",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-nikitama-extra-spirit-summon.test.ts",
      kind: "nikitamaAdditionalSpiritNormalSummon",
      required: [
        'const nikitamaCode = "24701235"',
        "restores its official additional Spirit Normal Summon count",
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-oath.test.ts",
      kind: "thunderSeaHorseTemporarySpecialSummonOath",
      required: [
        'const seaHorseCode = "48049769"',
        "restores its cost-created temporary EFFECT_CANNOT_SPECIAL_SUMMON and expires it at End Phase",
        "sea horse can special locked false",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonActivitySemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonActivitySemanticVariants(
  fixtures: Array<{ kind: SummonActivitySemanticVariant }>,
): Record<SummonActivitySemanticVariant, number> {
  return fixtures.reduce<Record<SummonActivitySemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      constellarLeonisExtraConstellarNormalSummon: 0,
      doubleSummonSecondNormalSummonGrant: 0,
      nikitamaAdditionalSpiritNormalSummon: 0,
      thunderSeaHorseTemporarySpecialSummonOath: 0,
    },
  );
}
