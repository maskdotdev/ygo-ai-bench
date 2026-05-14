import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lua deck probe manifest", () => {
  it("keeps every root .ydk deck covered by a package-level Lua probe gate", () => {
    const root = process.cwd();
    const deckNames = fs
      .readdirSync(root)
      .filter((name) => name.endsWith(".ydk"))
      .sort();
    const packageJson = fs.readFileSync("package.json", "utf8");

    const uncovered = deckNames.filter((name) => !packageJson.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(uncovered).toEqual([]);
  });
});
