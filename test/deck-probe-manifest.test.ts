import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Lua deck probe manifest", () => {
  it("keeps every root .ydk deck covered by a Lua probe or package gate", () => {
    const root = process.cwd();
    const deckNames = fs
      .readdirSync(root)
      .filter((name) => name.endsWith(".ydk"))
      .sort();
    const probeTest = fs.readFileSync(path.join(root, "test/lua-deck-probe.test.ts"), "utf8");
    const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");

    const uncovered = deckNames.filter((name) => !probeTest.includes(name) && !packageJson.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(uncovered).toEqual([]);
  });
});
