import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");
const groupedEventFixtureCount = 18;

describe("Lua grouped event restore coverage", () => {
  it("keeps every grouped event fixture covered by complete Lua-aware snapshot restore and legal actions", () => {
    const files = groupedEventFixtureFiles();
    expect(files).toHaveLength(groupedEventFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      });

    expect(missing).toEqual([]);
  });
});

function groupedEventFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-.*(?:source-only-)?grouped-event\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}
