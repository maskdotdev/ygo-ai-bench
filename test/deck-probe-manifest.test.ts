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
    const topTierDecks = deckNames.filter((name) => (pkg.scripts?.["probe:top-tier-deck"] ?? "").includes(name));
    const competitiveDecks = deckNames.filter((name) => (pkg.scripts?.["probe:competitive-decks"] ?? "").includes(name));
    const fallbackDecks = deckNames.filter((name) => (pkg.scripts?.["probe:fallback-decks"] ?? "").includes(name));
    const packageProbeDecks = [...topTierDecks, ...competitiveDecks, ...fallbackDecks].sort();
    const duplicated = packageProbeDecks.filter((name, index) => packageProbeDecks.indexOf(name) !== index);

    const uncovered = deckNames.filter((name) => !packageProbeDecks.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(topTierDecks).toHaveLength(1);
    expect(competitiveDecks).toHaveLength(11);
    expect(fallbackDecks).toHaveLength(9);
    expect(duplicated).toEqual([]);
    expect(uncovered).toEqual([]);
  });
});
