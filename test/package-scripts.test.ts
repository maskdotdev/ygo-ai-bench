import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("runs the Lua parity scanner in the default check gate", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["scan:lua-parity"]).toContain("--fail-on-missing --min-used-apis 898 --min-implemented-apis 1231 --min-upstream-constants 1777 --min-local-constants 1818");
    expect(pkg.scripts?.["scan:lua-local-parity"]).toBe("node tools/scan-lua-api-usage.mjs --scripts local-card-scripts --fail-on-missing --min-used-apis 0 --min-implemented-apis 1231");
    expect(pkg.scripts?.["scan:lua-chain-limits"]).toContain("tools/scan-lua-chain-limit-patterns.mjs");
    expect(pkg.scripts?.["scan:lua-prompts"]).toContain("tools/scan-lua-prompt-patterns.mjs");
    expect(pkg.scripts?.["scan:lua-clean-restore"]).toContain("tools/scan-lua-clean-restore.mjs");
    expect(pkg.scripts?.["check:loc"]).toBe("node tools/check-file-loc.mjs --baseline tools/file-loc-baseline.json");
    expect(pkg.scripts?.["scan:legal-action-evidence"]).toContain("tools/scan-legal-action-evidence.mjs");
    expect(pkg.scripts?.["scan:parity-fixture-provenance"]).toContain("tools/scan-parity-fixture-provenance.mjs");
    expect(pkg.scripts?.["report:parity-progress"]).toBe("node tools/report-parity-progress.mjs");
    expect(pkg.scripts?.["report:lua-behavior-signatures"]).toBe("node tools/report-lua-behavior-signatures.mjs");
    expect(pkg.scripts?.["probe:top-tier-deck"]).toContain("--fail-on-errors --require-card-database --min-upstream-scripts 30 --min-actions 18 --min-activate-effects 2 --min-initial-effects 53 --min-registered-effects 136 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("labrynth-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 38 --min-actions 9 --min-activate-effects 2 --min-initial-effects 60 --min-registered-effects 143 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("voiceless-voice-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 36 --min-actions 8 --min-activate-effects 2 --min-initial-effects 56 --min-registered-effects 156 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("marincess-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 29 --min-actions 11 --min-activate-effects 0 --min-initial-effects 55 --min-registered-effects 123 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("monarch-genesys-proto-ycs-dortmund-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 29 --min-actions 6 --min-activate-effects 2 --min-initial-effects 55 --min-registered-effects 152 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("kewl-tune-may-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 26 --min-actions 12 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 149 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("kashtira-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 30 --min-actions 13 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 145 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("exosister-ots-mar-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 31 --min-actions 13 --min-activate-effects 4 --min-initial-effects 55 --min-registered-effects 154 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("rikka-sunavalon-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 32 --min-actions 11 --min-activate-effects 3 --min-initial-effects 52 --min-registered-effects 124 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("dark-magical-blast-master-duel-day1.ydk --fail-on-errors --require-card-database --min-upstream-scripts 35 --min-actions 20 --min-activate-effects 2 --min-initial-effects 52 --min-registered-effects 141 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("dark-magical-blast-tcg-branded-dm.ydk --fail-on-errors --require-card-database --min-upstream-scripts 34 --min-actions 16 --min-activate-effects 2 --min-initial-effects 52 --min-registered-effects 138 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:competitive-decks"]).toContain("hero-competitive-may-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 39 --min-actions 10 --min-activate-effects 2 --min-initial-effects 59 --min-registered-effects 128 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("phantom-knights-mar-2026-v4.ydk --fail-on-errors --require-card-database --min-upstream-scripts 36 --min-actions 13 --min-activate-effects 2 --min-initial-effects 55 --min-registered-effects 145 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("solfachord-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 32 --min-actions 13 --min-activate-effects 4 --min-initial-effects 54 --min-registered-effects 177 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("magician-pendulum-mar-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 38 --min-actions 10 --min-activate-effects 5 --min-initial-effects 55 --min-registered-effects 204 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("rokket-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 40 --min-actions 12 --min-activate-effects 1 --min-initial-effects 55 --min-registered-effects 131 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("ancient-gear-legend-anthology-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 31 --min-actions 11 --min-activate-effects 1 --min-initial-effects 56 --min-registered-effects 161 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("onomat-ryzeal-ycs-guatemala-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 40 --min-actions 11 --min-activate-effects 3 --min-initial-effects 55 --min-registered-effects 126 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("mikanko-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 38 --min-actions 13 --min-activate-effects 3 --min-initial-effects 55 --min-registered-effects 159 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("branded-dracotail-ycs-guatemala-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 37 --min-actions 27 --min-activate-effects 2 --min-initial-effects 56 --min-registered-effects 138 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["probe:fallback-decks"]).toContain("ritual-of-light-and-darkness-apr-2026.ydk --fail-on-errors --require-card-database --min-upstream-scripts 33 --min-actions 7 --min-activate-effects 1 --min-initial-effects 54 --min-registered-effects 143 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 0");
    expect(pkg.scripts?.["check:bridge-bundle"]).toContain("tools/check-bridge-bundle.mjs");
    expect(pkg.scripts?.["check:pvp-bridge-bundle"]).toContain("tools/check-bridge-bundle.mjs --bridge dist/duel-pvp-engine.js");
    expect(pkg.scripts?.["check:pvp-bridge-bundle"]).toContain("--required autoRunVisible");
    expect(pkg.scripts?.["check:browser-assets"]).toBe("node tools/check-browser-asset-manifests.mjs --card-data public/card-data --card-scripts public/card-scripts");
    expect(pkg.scripts?.["export:browser-cdb"]).toContain("tools/export-browser-cdb-rows.mjs");
    expect(pkg.scripts?.["export:browser-cdb"]).toContain("--local-aliases local-card-scripts/script-aliases.json");
    expect(pkg.scripts?.["export:browser-cdb"]).toContain("--supplemental-rows local-card-scripts/card-data.json");
    expect(pkg.scripts?.["export:browser-cdb"]).toContain("--out public/card-data/cdb-rows.json");
    expect(pkg.scripts?.["export:browser-scripts"]).toContain("tools/export-browser-lua-scripts.mjs");
    expect(pkg.scripts?.["export:browser-scripts"]).toContain("--local-scripts local-card-scripts");
    expect(pkg.scripts?.["export:browser-scripts"]).toContain("--max-local-fallbacks 0 --max-local-alias-fallbacks 0 --max-local-provisional-fallbacks 0 --max-local-other-fallbacks 0");
    expect(pkg.scripts?.["export:browser-scripts"]).toContain("--out public/card-scripts");
    expect(pkg.scripts?.["export:browser-data"]).toBe("bun run export:browser-cdb && bun run export:browser-scripts && bun run check:browser-assets");
    expect(pkg.scripts?.check?.split(" && ")).toEqual([
      "bun run check:loc",
      "bun run scan:lua-parity",
      "bun run scan:lua-local-parity",
      "bun run scan:lua-chain-limits -- --min-files-with-calls 124 --min-calls 141 --fail-on-unclassified",
      "bun run scan:lua-prompts -- --min-files-with-calls 1957 --min-calls 2458 --min-select-option-calls 437 --min-select-yes-no-calls 1172 --min-select-effect-calls 352 --min-select-effect-yes-no-calls 250 --min-announcement-calls 247 --min-api-count AnnounceNumber 58 --min-api-count AnnounceNumberRange 24 --min-api-count AnnounceCard 33 --min-api-count AnnounceRace 24 --min-api-count AnnounceAttribute 33 --min-api-count AnnounceLevel 29 --min-api-count SelectCardsFromCodes 1 --min-api-count SelectDisableField 41 --min-api-count SelectFieldZone 4 --min-pattern-count SelectOption:leading-boolean-literals 1 --min-pattern-count SelectOption:leading-boolean-table-unpack 1 --min-pattern-count SelectOption:table-unpack 19 --min-pattern-count SelectEffect:dynamic-options 3 --min-pattern-count AnnounceNumber:table-unpack 39 --min-pattern-count AnnounceCard:table-unpack 18 --fail-on-unclassified",
      "bun run scan:lua-clean-restore -- --min-percent 100 --min-fixtures 1770 --min-coverage-files 100 --fail-on-missing --fail-on-missing-diagnostics --fail-on-missing-legal-actions --fail-on-unreferenced",
      "bun run scan:lua-event-assertions -- --min-fixtures 1770 --fail-on-broad-event-matchers --fail-on-partial-event-match-objects",
      "bun run scan:lua-chain-assertions -- --min-fixtures 1770 --max-partial-chain-match-objects 0 --max-broad-chain-object-containing 0",
      "bun run scan:lua-effect-assertions -- --min-fixtures 1770 --max-broad-effect-collection-assertions 0",
      "bun run scan:parity-fixture-provenance -- --min-files 945 --min-expectation-blocks 4939 --min-edopro-blocks 4939 --min-restored-fixtures 938 --min-restored-before-blocks 2181 --min-restored-after-blocks 1817 --min-restored-window-blocks 3998 --min-final-expected-blocks 941 --max-unrestored-before-blocks 0 --max-unrestored-after-blocks 0 --max-after-only-restore-steps 0 --fail-on-missing-source --fail-on-invalid-source --fail-on-missing-note --fail-on-weak-note --fail-on-backlog --fail-on-missing-restore",
      "bun run scan:legal-action-evidence -- --min-files 945 --min-edopro-blocks 4939 --min-action-count-evidence-blocks 4939 --min-group-count-evidence-blocks 4939 --min-paired-count-evidence-blocks 4939 --min-action-evidence-blocks 4939 --min-group-evidence-blocks 4939 --min-group-action-evidence-blocks 4939 --min-window-evidence-blocks 4939 --min-top-level-window-evidence-blocks 4939 --min-action-window-evidence-blocks 4939 --min-group-window-evidence-blocks 4939 --min-absent-action-evidence-blocks 4175 --min-absent-group-evidence-blocks 4175 --min-paired-absent-evidence-blocks 4175 --min-absent-action-window-evidence-blocks 4175 --min-absent-group-window-evidence-blocks 4175 --min-action-evidence-percent 100 --min-group-evidence-percent 100 --fail-on-missing --fail-on-missing-counts --fail-on-empty --fail-on-zero-only --fail-on-zero-evidence --fail-on-missing-action-window-evidence --fail-on-missing-group-actions --fail-on-missing-group-window-evidence --fail-on-unpaired-absent --fail-on-empty-absent --fail-on-missing-absent-action-window-evidence --fail-on-missing-absent-group-window-evidence --fail-on-missing-window-evidence --fail-on-missing-top-level-window-evidence",
      "bun run probe:top-tier-deck",
      "bun run probe:competitive-decks",
      "bun run probe:fallback-decks",
      "bun run export:browser-data",
      "bun run typecheck",
      "bun run test",
      "bun run build",
      "bun run check:bridge-bundle",
      "bun run check:pvp-bridge-bundle",
    ]);
    expect(pkg.scripts?.check).not.toMatch(/\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b/);
    expect(pkg.scripts?.check?.split(" && ").filter((command) => command.includes("test"))).toEqual(["bun run test"]);
  });

  it("keeps generated browser asset exports out of source control", () => {
    const ignore = fs.readFileSync(".gitignore", "utf8").split(/\r?\n/);

    expect(ignore).toContain("public/card-data/");
    expect(ignore).toContain("public/card-scripts/");
  });

  it("keeps browser Lua fallback export budgets ratcheted to the local fallback inventory", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    const exportScript = pkg.scripts?.["export:browser-scripts"] ?? "";
    const fallbackScripts = fs
      .readdirSync("local-card-scripts/fallbacks/official")
      .filter((file) => file.endsWith(".lua"))
      .map((file) => fs.readFileSync(`local-card-scripts/fallbacks/official/${file}`, "utf8"));
    const aliasFallbacks = fallbackScripts.filter((source) => /Duel\.LoadCardScriptAlias\(\d+\)/.test(source));
    const provisionalFallbacks = fallbackScripts.filter((source) => source.includes("local-fallback-provisional"));
    const otherFallbacks = fallbackScripts.length - aliasFallbacks.length - provisionalFallbacks.length;

    expect(readBudget(exportScript, "--max-local-fallbacks")).toBe(fallbackScripts.length);
    expect(readBudget(exportScript, "--max-local-alias-fallbacks")).toBe(aliasFallbacks.length);
    expect(readBudget(exportScript, "--max-local-provisional-fallbacks")).toBe(provisionalFallbacks.length);
    expect(readBudget(exportScript, "--max-local-other-fallbacks")).toBe(otherFallbacks);
  });
});

function readBudget(command: string, flag: string): number {
  const match = command.match(new RegExp(`${flag} (\\d+)`));
  return Number(match?.[1] ?? -1);
}
