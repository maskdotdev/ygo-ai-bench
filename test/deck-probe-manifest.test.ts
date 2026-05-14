import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lua deck probe manifest", () => {
  it("keeps every root .ydk deck covered by a package-level Lua probe gate", () => {
    const root = process.cwd();
    const deckNames = fs
      .readdirSync(root)
      .filter((name) => name.endsWith(".ydk"))
      .sort();
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    const packageProbeScripts = [
      pkg.scripts?.["probe:top-tier-deck"] ?? "",
      pkg.scripts?.["probe:competitive-decks"] ?? "",
      pkg.scripts?.["probe:fallback-decks"] ?? "",
    ].join("\n");

    const uncovered = deckNames.filter((name) => !packageProbeScripts.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(uncovered).toEqual([]);
  });
});
