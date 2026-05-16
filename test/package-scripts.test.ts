import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("runs the Lua parity scanner in the default check gate", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["scan:lua-parity"]).toContain("--fail-on-missing --min-used-apis 898 --min-implemented-apis 1213 --min-upstream-constants 1774 --min-local-constants 1815");
    expect(pkg.scripts?.["scan:lua-chain-limits"]).toContain("tools/scan-lua-chain-limit-patterns.mjs");
    expect(pkg.scripts?.["scan:lua-prompts"]).toContain("tools/scan-lua-prompt-patterns.mjs");
    expect(pkg.scripts?.["scan:lua-clean-restore"]).toContain("tools/scan-lua-clean-restore.mjs");
    expect(pkg.scripts?.["scan:legal-action-evidence"]).toContain("tools/scan-legal-action-evidence.mjs");
    expect(pkg.scripts?.["scan:parity-fixture-provenance"]).toContain("tools/scan-parity-fixture-provenance.mjs");
    expect(pkg.scripts?.["probe:top-tier-deck"]).toContain("--fail-on-errors --min-upstream-scripts 30 --min-actions 10 --min-activate-effects 2 --min-initial-effects 53 --min-registered-effects 136 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 2 --expected-missing-script-code 89631139 --expected-missing-script-code 46986414");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("labrynth-2026.ydk --fail-on-errors --min-upstream-scripts 38 --min-actions 10 --min-activate-effects 2 --min-initial-effects 60 --min-registered-effects 143 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("voiceless-voice-2026.ydk --fail-on-errors --min-upstream-scripts 36 --min-actions 9 --min-activate-effects 2 --min-initial-effects 56 --min-registered-effects 154 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("marincess-2026.ydk --fail-on-errors --min-upstream-scripts 29 --min-actions 11 --min-initial-effects 55 --min-registered-effects 123 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("monarch-genesys-proto-ycs-dortmund-2026.ydk --fail-on-errors --min-upstream-scripts 29 --min-actions 6 --min-activate-effects 2 --min-initial-effects 55 --min-registered-effects 152 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("kewl-tune-may-2026.ydk --fail-on-errors --min-upstream-scripts 26 --min-actions 12 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 149 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("kashtira-2026.ydk --fail-on-errors --min-upstream-scripts 30 --min-actions 10 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 145 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("exosister-ots-mar-2026.ydk --fail-on-errors --min-upstream-scripts 31 --min-actions 13 --min-activate-effects 4 --min-initial-effects 55 --min-registered-effects 154 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("rikka-sunavalon-2026.ydk --fail-on-errors --min-upstream-scripts 32 --min-actions 11 --min-activate-effects 3 --min-initial-effects 52 --min-registered-effects 124 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 1 --expected-missing-script-code 27520594");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("dark-magical-blast-master-duel-day1.ydk --fail-on-errors --min-upstream-scripts 35 --min-actions 8 --min-activate-effects 2 --min-initial-effects 52 --min-registered-effects 141 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 2 --expected-missing-script-code 46986414 --expected-missing-script-code 74677422");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("dark-magical-blast-tcg-branded-dm.ydk --fail-on-errors --min-upstream-scripts 34 --min-actions 8 --min-activate-effects 2 --min-initial-effects 52 --min-registered-effects 138 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 2 --expected-missing-script-code 46986414 --expected-missing-script-code 74677422");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("hero-competitive-may-2026.ydk --fail-on-errors --min-upstream-scripts 39 --min-actions 10 --min-activate-effects 2 --min-initial-effects 59 --min-registered-effects 128 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 1 --expected-missing-script-code 89943723");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("phantom-knights-mar-2026-v4.ydk --fail-on-errors --min-upstream-scripts 35 --min-actions 13 --min-activate-effects 2 --min-initial-effects 55 --min-registered-effects 145 --max-local-overrides 0 --max-local-fallbacks 1 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("solfachord-2026.ydk --fail-on-errors --min-upstream-scripts 32 --min-actions 13 --min-activate-effects 4 --min-initial-effects 54 --min-registered-effects 177 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("magician-pendulum-mar-2026.ydk --fail-on-errors --min-upstream-scripts 37 --min-actions 10 --min-activate-effects 5 --min-initial-effects 55 --min-registered-effects 204 --max-local-overrides 0 --max-local-fallbacks 1 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("rokket-2026.ydk --fail-on-errors --min-upstream-scripts 39 --min-actions 12 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 131 --max-local-overrides 0 --max-local-fallbacks 1 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("ancient-gear-legend-anthology-2026.ydk --fail-on-errors --min-upstream-scripts 31 --min-actions 9 --min-activate-effects 1 --min-initial-effects 56 --min-registered-effects 161 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("onomat-ryzeal-ycs-guatemala-2026.ydk --fail-on-errors --min-upstream-scripts 40 --min-actions 11 --min-activate-effects 3 --min-initial-effects 55 --min-registered-effects 126 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("mikanko-2026.ydk --fail-on-errors --min-upstream-scripts 38 --min-actions 13 --min-activate-effects 3 --min-initial-effects 55 --min-registered-effects 159 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("branded-dracotail-ycs-guatemala-2026.ydk --fail-on-errors --min-upstream-scripts 37 --min-actions 11 --min-activate-effects 2 --min-initial-effects 56 --min-registered-effects 138 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("ritual-of-light-and-darkness-apr-2026.ydk --fail-on-errors --min-upstream-scripts 23 --min-actions 8 --min-activate-effects 1 --min-initial-effects 54 --min-registered-effects 141 --max-local-overrides 0 --max-local-fallbacks 10 --max-expected-missing-scripts 1 --expected-missing-script-code 46986414");
    expect(pkg.scripts?.["check:bridge-bundle"]).toContain("tools/check-bridge-bundle.mjs");
    expect(pkg.scripts?.["check:pvp-bridge-bundle"]).toContain("tools/check-bridge-bundle.mjs --bridge dist/duel-pvp-engine.js");
    expect(pkg.scripts?.check?.split(" && ")).toEqual([
      "bun run check:loc",
      "bun run scan:lua-parity",
      "bun run scan:lua-chain-limits -- --min-files-with-calls 123 --min-calls 140 --fail-on-unclassified",
      "bun run scan:lua-prompts -- --min-files-with-calls 1957 --min-calls 2458 --min-select-option-calls 437 --min-select-yes-no-calls 1172 --min-select-effect-calls 352 --min-select-effect-yes-no-calls 250 --min-announcement-calls 247 --min-api-count AnnounceNumber 58 --min-api-count AnnounceNumberRange 24 --min-api-count AnnounceCard 33 --min-api-count AnnounceRace 24 --min-api-count AnnounceAttribute 33 --min-api-count AnnounceLevel 29 --min-api-count SelectCardsFromCodes 1 --min-api-count SelectDisableField 41 --min-api-count SelectFieldZone 4 --min-pattern-count SelectOption:leading-boolean-literals 1 --min-pattern-count SelectOption:leading-boolean-table-unpack 1 --min-pattern-count SelectOption:table-unpack 19 --min-pattern-count SelectEffect:dynamic-options 3 --min-pattern-count AnnounceNumber:table-unpack 39 --min-pattern-count AnnounceCard:table-unpack 18 --fail-on-unclassified",
      "bun run scan:lua-clean-restore -- --min-percent 100 --min-fixtures 560 --min-coverage-files 68 --fail-on-missing --fail-on-unreferenced",
      "bun run scan:lua-event-assertions -- --min-fixtures 560 --fail-on-broad-event-matchers --fail-on-partial-event-match-objects",
      "bun run scan:lua-chain-assertions -- --min-fixtures 560 --max-partial-chain-match-objects 0 --max-broad-chain-object-containing 0",
      "bun run scan:lua-effect-assertions -- --min-fixtures 560 --max-broad-effect-collection-assertions 0",
      "bun run scan:parity-fixture-provenance -- --min-files 935 --min-expectation-blocks 4793 --min-edopro-blocks 4793 --min-restored-fixtures 930 --fail-on-missing-source --fail-on-invalid-source --fail-on-missing-note --fail-on-weak-note --fail-on-backlog --fail-on-missing-restore",
      "bun run scan:legal-action-evidence -- --min-files 935 --min-edopro-blocks 4793 --min-action-evidence-blocks 4793 --min-group-evidence-blocks 4793 --min-action-evidence-percent 100 --min-group-evidence-percent 100 --fail-on-missing --fail-on-empty --fail-on-zero-only --fail-on-zero-evidence",
      "bun run probe:top-tier-deck",
      "bun run probe:competitive-decks",
      "bun run probe:fallback-decks",
      "bun run typecheck",
      "bun run test",
      "bun run build",
      "bun run check:bridge-bundle",
      "bun run check:pvp-bridge-bundle",
    ]);
    expect(pkg.scripts?.check).not.toMatch(/\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b/);
    expect(pkg.scripts?.check?.split(" && ").filter((command) => command.includes("test"))).toEqual(["bun run test"]);
  });
});
