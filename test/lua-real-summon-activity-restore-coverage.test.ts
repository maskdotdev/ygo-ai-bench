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

type SummonActivityKind =
  | "archetypeExtraNormalSummon"
  | "genericExtraNormalSummon"
  | "specialSummonOath"
  | "spiritExtraNormalSummon";

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
