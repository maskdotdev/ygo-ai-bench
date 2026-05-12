import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");

describe("Lua grouped event restore coverage", () => {
  it("keeps every grouped event fixture covered by Lua-aware snapshot restore", () => {
    const missing = groupedEventFixtureFiles()
      .filter((file) => !fs.readFileSync(path.join(root, file), "utf8").includes("restoreDuelWithLuaScripts"));

    expect(missing).toEqual([]);
  });
});

function groupedEventFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-.*(?:source-only-)?grouped-event\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}
