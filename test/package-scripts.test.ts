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
    expect(pkg.scripts?.["probe:top-tier-deck"]).toContain("--fail-on-errors --min-upstream-scripts 30 --min-actions 10 --min-activate-effects 2 --min-initial-effects 53 --min-registered-effects 136 --max-local-overrides 0 --max-local-fallbacks 0 --max-expected-missing-scripts 2");
    expect(pkg.scripts?.["check:bridge-bundle"]).toContain("tools/check-bridge-bundle.mjs");
    expect(pkg.scripts?.check?.split(" && ")).toEqual([
      "bun run check:loc",
      "bun run scan:lua-parity",
      "bun run scan:lua-chain-limits -- --min-files-with-calls 123 --min-calls 140 --fail-on-unclassified",
      "bun run scan:lua-prompts -- --min-files-with-calls 1957 --min-calls 2458 --min-select-option-calls 437 --min-select-yes-no-calls 1172 --min-select-effect-calls 352 --min-select-effect-yes-no-calls 250 --min-announcement-calls 247 --min-api-count AnnounceNumber 58 --min-api-count AnnounceNumberRange 24 --min-api-count AnnounceCard 33 --min-api-count AnnounceRace 24 --min-api-count AnnounceAttribute 33 --min-api-count AnnounceLevel 29 --min-api-count SelectCardsFromCodes 1 --min-api-count SelectDisableField 41 --min-api-count SelectFieldZone 4 --min-pattern-count SelectOption:leading-boolean-literals 1 --min-pattern-count SelectOption:leading-boolean-table-unpack 1 --min-pattern-count SelectOption:table-unpack 19 --min-pattern-count SelectEffect:dynamic-options 3 --min-pattern-count AnnounceNumber:table-unpack 39 --min-pattern-count AnnounceCard:table-unpack 18 --fail-on-unclassified",
      "bun run scan:lua-clean-restore -- --min-percent 100 --min-fixtures 494 --min-coverage-files 68 --fail-on-missing --fail-on-unreferenced",
      "bun run scan:parity-fixture-provenance -- --min-files 860 --min-expectation-blocks 4493 --min-edopro-blocks 4493 --min-restored-fixtures 855 --fail-on-missing-source --fail-on-invalid-source --fail-on-missing-note --fail-on-weak-note --fail-on-backlog --fail-on-missing-restore",
      "bun run scan:legal-action-evidence -- --min-files 860 --min-edopro-blocks 4493 --min-action-evidence-blocks 4381 --min-group-evidence-blocks 4381 --min-action-evidence-percent 94 --min-group-evidence-percent 95 --fail-on-missing --fail-on-empty --fail-on-zero-only --fail-on-zero-evidence",
      "bun run probe:top-tier-deck",
      "bun run typecheck",
      "bun run test",
      "bun run build",
      "bun run check:bridge-bundle",
    ]);
  });
});
