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
    const packageProbeCommands = [
      ...(pkg.scripts?.["probe:top-tier-deck"] ?? "").split(" && "),
      ...(pkg.scripts?.["probe:competitive-decks"] ?? "").split(" && "),
      ...(pkg.scripts?.["probe:fallback-decks"] ?? "").split(" && "),
    ];
    const packageProbeDecks = [...topTierDecks, ...competitiveDecks, ...fallbackDecks].sort();
    const duplicated = packageProbeDecks.filter((name, index) => packageProbeDecks.indexOf(name) !== index);
    const looseProbeCommands = packageProbeCommands.filter(
      (command) =>
        !command.includes("--fail-on-errors") ||
        !command.includes("--max-local-overrides 0") ||
        !/--max-local-fallbacks \d+/.test(command) ||
        !/--max-expected-missing-scripts \d+/.test(command),
    );

    const uncovered = deckNames.filter((name) => !packageProbeDecks.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(topTierDecks).toEqual(["top_tier_dark_magician_primite_azamina.ydk"]);
    expect(competitiveDecks).toEqual([
      "dark-magical-blast-master-duel-day1.ydk",
      "dark-magical-blast-tcg-branded-dm.ydk",
      "exosister-ots-mar-2026.ydk",
      "hero-competitive-may-2026.ydk",
      "kashtira-2026.ydk",
      "kewl-tune-may-2026.ydk",
      "labrynth-2026.ydk",
      "marincess-2026.ydk",
      "monarch-genesys-proto-ycs-dortmund-2026.ydk",
      "rikka-sunavalon-2026.ydk",
      "voiceless-voice-2026.ydk",
    ]);
    expect(fallbackDecks).toEqual([
      "ancient-gear-legend-anthology-2026.ydk",
      "branded-dracotail-ycs-guatemala-2026.ydk",
      "magician-pendulum-mar-2026.ydk",
      "mikanko-2026.ydk",
      "onomat-ryzeal-ycs-guatemala-2026.ydk",
      "phantom-knights-mar-2026-v4.ydk",
      "ritual-of-light-and-darkness-apr-2026.ydk",
      "rokket-2026.ydk",
      "solfachord-2026.ydk",
    ]);
    expect(duplicated).toEqual([]);
    expect(looseProbeCommands).toEqual([]);
    expect(uncovered).toEqual([]);
  });
});
