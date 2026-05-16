import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const upstreamRoot = ".upstream/ignis";
const hasUpstreamDatabase = fs.existsSync(`${upstreamRoot}/cdb/cards.cdb`);

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
    const malformedProbeCommands = packageProbeCommands.filter((command) => !/^bun run probe:lua-deck -- \S+\.ydk /.test(command));
    const packageProbeDecks = [...topTierDecks, ...competitiveDecks, ...fallbackDecks].sort();
    const duplicated = packageProbeDecks.filter((name, index) => packageProbeDecks.indexOf(name) !== index);
    const looseProbeCommands = packageProbeCommands.filter(
      (command) =>
        !command.includes("--fail-on-errors") ||
        !command.includes("--max-local-overrides 0") ||
        !/--max-local-fallbacks \d+/.test(command) ||
        !/--max-expected-missing-scripts \d+/.test(command),
    );
    const unbudgetedProbeCommands = packageProbeCommands.filter(
      (command) =>
        !/--min-upstream-scripts \d+/.test(command) ||
        !/--min-actions \d+/.test(command) ||
        !/--min-initial-effects \d+/.test(command) ||
        !/--min-registered-effects \d+/.test(command),
    );
    const activateEffectFloorOmissions = packageProbeCommands
      .filter((command) => !/--min-activate-effects \d+/.test(command))
      .map((command) => command.match(/-- (\S+\.ydk) /)?.[1] ?? command)
      .sort();
    const expectedMissingBudgetMismatches = packageProbeCommands
      .filter((command) => {
        const maximum = Number(command.match(/--max-expected-missing-scripts (\d+)/)?.[1] ?? -1);
        const codes = [...command.matchAll(/--expected-missing-script-code \d+/g)];
        return maximum !== codes.length;
      })
      .map((command) => command.match(/-- (\S+\.ydk) /)?.[1] ?? command)
      .sort();
    const localFallbackBudgetMismatches = packageProbeCommands
      .filter((command) => {
        const maximum = Number(command.match(/--max-local-fallbacks (\d+)/)?.[1] ?? -1);
        const codes = [...command.matchAll(/--expected-local-fallback-script-code \d+/g)];
        return maximum !== codes.length;
      })
      .map((command) => command.match(/-- (\S+\.ydk) /)?.[1] ?? command)
      .sort();
    const localFallbackBudgetDecks = packageProbeCommands
      .filter((command) => Number(command.match(/--max-local-fallbacks (\d+)/)?.[1] ?? 0) > 0)
      .map((command) => command.match(/-- (\S+\.ydk) /)?.[1] ?? command)
      .sort();
    const localFallbackBudgets = Object.fromEntries(
      packageProbeCommands
        .map((command): [string, number] => [
          command.match(/-- (\S+\.ydk) /)?.[1] ?? command,
          Number(command.match(/--max-local-fallbacks (\d+)/)?.[1] ?? -1),
        ])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    const expectedMissingScriptCodesByDeck = Object.fromEntries(
      packageProbeCommands
        .map((command) => [
          command.match(/-- (\S+\.ydk) /)?.[1] ?? command,
          [...command.matchAll(/--expected-missing-script-code (\d+)/g)].map((match) => match[1]).sort(),
        ] as const)
        .filter(([, codes]) => codes.length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    const expectedLocalFallbackScriptCodesByDeck = Object.fromEntries(
      packageProbeCommands
        .map((command) => [
          command.match(/-- (\S+\.ydk) /)?.[1] ?? command,
          [...command.matchAll(/--expected-local-fallback-script-code (\d+)/g)].map((match) => match[1]).sort(),
        ] as const)
        .filter(([, codes]) => codes.length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    const fallbackScriptCodes = fs
      .readdirSync("local-card-scripts/fallbacks/official")
      .filter((file) => file.endsWith(".lua"))
      .map((file) => file.replace(/^c/, "").replace(/\.lua$/, ""))
      .sort();
    const expectedLocalFallbackScriptCodes = [...new Set(Object.values(expectedLocalFallbackScriptCodesByDeck).flat())].sort();

    const uncovered = deckNames.filter((name) => !packageProbeDecks.includes(name));

    expect(deckNames).toHaveLength(21);
    expect(packageProbeCommands).toHaveLength(21);
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
    expect(malformedProbeCommands).toEqual([]);
    expect(looseProbeCommands).toEqual([]);
    expect(unbudgetedProbeCommands).toEqual([]);
    expect(activateEffectFloorOmissions).toEqual([]);
    expect(expectedMissingBudgetMismatches).toEqual([]);
    expect(localFallbackBudgetMismatches).toEqual([]);
    expect(localFallbackBudgetDecks).toEqual([
      "magician-pendulum-mar-2026.ydk",
      "phantom-knights-mar-2026-v4.ydk",
      "ritual-of-light-and-darkness-apr-2026.ydk",
      "rokket-2026.ydk",
    ]);
    expect(localFallbackBudgets).toEqual({
      "ancient-gear-legend-anthology-2026.ydk": 0,
      "branded-dracotail-ycs-guatemala-2026.ydk": 0,
      "dark-magical-blast-master-duel-day1.ydk": 0,
      "dark-magical-blast-tcg-branded-dm.ydk": 0,
      "exosister-ots-mar-2026.ydk": 0,
      "hero-competitive-may-2026.ydk": 0,
      "kashtira-2026.ydk": 0,
      "kewl-tune-may-2026.ydk": 0,
      "labrynth-2026.ydk": 0,
      "magician-pendulum-mar-2026.ydk": 1,
      "marincess-2026.ydk": 0,
      "mikanko-2026.ydk": 0,
      "monarch-genesys-proto-ycs-dortmund-2026.ydk": 0,
      "onomat-ryzeal-ycs-guatemala-2026.ydk": 0,
      "phantom-knights-mar-2026-v4.ydk": 1,
      "rikka-sunavalon-2026.ydk": 0,
      "ritual-of-light-and-darkness-apr-2026.ydk": 10,
      "rokket-2026.ydk": 1,
      "solfachord-2026.ydk": 0,
      "top_tier_dark_magician_primite_azamina.ydk": 0,
      "voiceless-voice-2026.ydk": 0,
    });
    expect(expectedMissingScriptCodesByDeck).toEqual({
      "dark-magical-blast-master-duel-day1.ydk": ["46986414", "74677422"],
      "dark-magical-blast-tcg-branded-dm.ydk": ["46986414", "74677422"],
      "hero-competitive-may-2026.ydk": ["89943723"],
      "rikka-sunavalon-2026.ydk": ["27520594"],
      "ritual-of-light-and-darkness-apr-2026.ydk": ["46986414"],
      "top_tier_dark_magician_primite_azamina.ydk": ["46986414", "89631139"],
    });
    expect(expectedLocalFallbackScriptCodesByDeck).toEqual({
      "magician-pendulum-mar-2026.ydk": ["100452013"],
      "phantom-knights-mar-2026-v4.ydk": ["100452015"],
      "ritual-of-light-and-darkness-apr-2026.ydk": ["2372506", "24088928", "24461358", "24749710", "33599853", "44001993", "50073633", "70405001", "97462632", "98684220"],
      "rokket-2026.ydk": ["101303089"],
    });
    expect(expectedLocalFallbackScriptCodes).toEqual(fallbackScriptCodes);
    expect(uncovered).toEqual([]);
  });
});

describe.skipIf(!hasUpstreamDatabase)("Lua deck expected-missing script manifest", () => {
  it("only budgets scriptless normal monsters as expected missing scripts", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    const packageProbeCommands = [
      ...(pkg.scripts?.["probe:top-tier-deck"] ?? "").split(" && "),
      ...(pkg.scripts?.["probe:competitive-decks"] ?? "").split(" && "),
      ...(pkg.scripts?.["probe:fallback-decks"] ?? "").split(" && "),
    ];
    const expectedMissingCodes = [...new Set(packageProbeCommands.flatMap((command) => [...command.matchAll(/--expected-missing-script-code (\d+)/g)].flatMap((match) => match[1] ? [match[1]] : [])))].sort();
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cardsByCode = new Map(workspace.readDatabaseCards("cards.cdb").map((card) => [card.code, card]));
    const expectedMissingCards = Object.fromEntries(
      expectedMissingCodes.map((code) => {
        const card = cardsByCode.get(code);
        return [
          code,
          {
            name: card?.name,
            typeFlags: card?.typeFlags,
            scriptlessNormal: isScriptlessNormalMonster(card?.typeFlags),
          },
        ];
      }),
    );

    expect(expectedMissingCards).toEqual({
      "27520594": { name: "Sunseed Genius Loci", typeFlags: 17, scriptlessNormal: true },
      "46986414": { name: "Dark Magician", typeFlags: 17, scriptlessNormal: true },
      "74677422": { name: "Red-Eyes Black Dragon", typeFlags: 17, scriptlessNormal: true },
      "89631139": { name: "Blue-Eyes White Dragon", typeFlags: 17, scriptlessNormal: true },
      "89943723": { name: "Elemental HERO Neos", typeFlags: 17, scriptlessNormal: true },
    });
  });
});

function isScriptlessNormalMonster(typeFlags: number | undefined): boolean {
  if (typeFlags === undefined) return false;
  const isMonster = (typeFlags & 0x1) !== 0;
  const isNormal = (typeFlags & 0x10) !== 0;
  const hasScriptBearingType = (typeFlags & (
    0x2 |
    0x4 |
    0x20 |
    0x40 |
    0x80 |
    0x2000 |
    0x800000 |
    0x1000000 |
    0x4000000
  )) !== 0;
  return isMonster && isNormal && !hasScriptBearingType;
}
