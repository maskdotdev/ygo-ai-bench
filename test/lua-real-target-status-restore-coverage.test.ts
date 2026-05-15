import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const targetStatusFixtureCount = 3;

describe("Lua real target-status restore coverage", () => {
  it("requires target-status descriptor fixtures to assert clean Lua registry restore and restored predicate truth tables", () => {
    const files = targetStatusFixtureFiles();
    expect(files).toHaveLength(targetStatusFixtureCount);

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
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("targetCardPredicate")
          || !text.includes("toBe(true)")
          || !text.includes("toBe(false)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function targetStatusFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-target-status-not.test.ts",
      required: [
        "target:not-status:",
        "summonType = \"link\"",
        "customStatusMask = 0x20",
      ],
    },
    {
      file: "test/lua-real-script-target-status-summon-location.test.ts",
      required: [
        "target:status-summon-location:",
        "previousLocation = \"extraDeck\"",
        "previousLocation = \"hand\"",
      ],
    },
    {
      file: "test/lua-real-script-target-status.test.ts",
      required: [
        "target:status:",
        "summonType = \"link\"",
        "customStatusMask = 0x20000000",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
