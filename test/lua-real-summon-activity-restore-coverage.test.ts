import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const summonActivityFixtureCount = 4;

describe("Lua real summon activity restore coverage", () => {
  it("requires summon activity fixtures to assert clean restore and restored legal actions", () => {
    const files = summonActivityFixtureFiles();
    expect(files).toHaveLength(summonActivityFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function summonActivityFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-constellar-leonis-extra-summon-count.test.ts",
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
      required: [
        "sea horse can special locked false",
        "sea horse special locked 0",
        "sea horse can special after end true",
        "sea horse special after end 1",
        'action.type === "endTurn"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
