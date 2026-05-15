import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const provenanceScannerPath = path.resolve("tools/scan-parity-fixture-provenance.mjs");
const legalActionScannerPath = path.resolve("tools/scan-legal-action-evidence.mjs");
const beforeExpectationKey = "before";
const afterExpectationKey = "after";

describe("parity scanner CLIs", () => {
  it("fails on missing, invalid, missing-note, and weak-note provenance when requested", () => {
    const testRoot = makeTestRoot({
      "parity-provenance-errors.test.ts": `
        runScriptedDuelFixture({
          ${beforeExpectationKey}: {
            note: "EDOPro observed a missing source.",
          },
          ${afterExpectationKey}: {
            source: "local",
            note: "EDOPro observed an invalid source.",
          },
          expected: {
            source: "edopro",
          },
        });
      `,
      "parity-weak-note.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "Local-only note.",
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--fail-on-missing-source",
      "--fail-on-invalid-source",
      "--fail-on-missing-note",
      "--fail-on-weak-note",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Parity fixture provenance: 2 files, 4 expectation blocks, 2 EDOPro, 0 backlog");
    expect(result.stderr).toContain("Expectation blocks missing source");
    expect(result.stderr).toContain("parity-provenance-errors.test.ts:3");
    expect(result.stderr).toContain("Expectation blocks with invalid source");
    expect(result.stderr).toContain("parity-provenance-errors.test.ts:6");
    expect(result.stderr).toContain("Sourced expectation blocks missing observation note");
    expect(result.stderr).toContain("parity-provenance-errors.test.ts:10");
    expect(result.stderr).toContain("Observation notes that do not reference EDOPro");
    expect(result.stderr).toContain("parity-weak-note.test.ts:3");
  });

  it("fails on remaining parity-backlog expectation blocks when requested", () => {
    const testRoot = makeTestRoot({
      "parity-backlog-case.test.ts": `
        runScriptedDuelFixture({
          after: {
            source: "parity-backlog",
            note: "EDOPro observed this pending behavior",
            waitingFor: 0,
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [provenanceScannerPath, "--test-root", testRoot, "--fail-on-backlog"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Parity fixture provenance: 1 files, 1 expectation blocks, 0 EDOPro, 1 backlog");
    expect(result.stderr).toContain("Parity backlog expectation blocks remain: 1");
  });

  it("fails on scripted parity fixtures missing snapshot restore when requested", () => {
    const testRoot = makeTestRoot({
      "parity-no-restore.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "EDOPro observed this state.",
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [provenanceScannerPath, "--test-root", testRoot, "--fail-on-missing-restore"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Parity fixture provenance: 1 files, 1 expectation blocks, 1 EDOPro, 0 backlog, 0 restored scripted fixtures");
    expect(result.stderr).toContain("Scripted parity fixtures missing snapshotRestore");
    expect(result.stderr).toContain("parity-no-restore.test.ts");
  });

  it("fails when the scanned provenance corpus is below required floors", () => {
    const testRoot = makeTestRoot({
      "parity-small-corpus.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "Observed in EDOPro for scanner floor coverage.",
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--min-files",
      "2",
      "--min-expectation-blocks",
      "2",
      "--min-edopro-blocks",
      "2",
      "--min-restored-fixtures",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Parity fixture provenance: 1 files, 1 expectation blocks, 1 EDOPro, 0 backlog, 0 restored scripted fixtures");
    expect(result.stderr).toContain("Parity fixture files 1 is below required 2");
    expect(result.stderr).toContain("Expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("EDOPro expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("Restored scripted fixtures 0 is below required 2");
  });

  it("scans non-fixture parity test files for legal-action evidence", () => {
    const testRoot = makeTestRoot({
      "parity-non-fixture.test.ts": `
        runScriptedDuelFixture({
          after: {
            source: "edopro",
            note: "EDOPro observed legal actions",
            legalActionCounts: { 0: 1, 1: 0 },
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [legalActionScannerPath, "--test-root", testRoot, "--fail-on-missing"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("EDOPro legal-action evidence: 1 parity files, 1 EDOPro expectation blocks");
    expect(result.stderr).toContain("Aggregate counts missing concrete legal-action evidence");
    expect(result.stderr).toContain("parity-non-fixture.test.ts:3");
  });

  it("fails when legal-action evidence is below required corpus floors", () => {
    const testRoot = makeTestRoot({
      "parity-small-evidence.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "Observed in EDOPro for legal-action floor coverage.",
            legalActionCounts: { normalSummon: 1 },
            legalActions: [{ type: "normalSummon", count: 1 }],
            legalActionGroupCounts: { summon: 1 },
            legalActionGroups: [{ group: "summon", count: 1 }],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--min-files",
      "2",
      "--min-edopro-blocks",
      "2",
      "--min-action-evidence-blocks",
      "2",
      "--min-group-evidence-blocks",
      "2",
      "--min-action-evidence-percent",
      "100",
      "--min-group-evidence-percent",
      "100",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("EDOPro legal-action evidence: 1 parity files, 1 EDOPro expectation blocks, 1 action evidence blocks, 1 group evidence blocks");
    expect(result.stderr).toContain("Parity fixture files 1 is below required 2");
    expect(result.stderr).toContain("EDOPro expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("Action evidence blocks 1 is below required 2");
    expect(result.stderr).toContain("Group evidence blocks 1 is below required 2");
  });

  it("fails when legal-action evidence is below required coverage percentages", () => {
    const testRoot = makeTestRoot({
      "parity-partial-evidence.test.ts": `
        runScriptedDuelFixture({
          before: {
            source: "edopro",
            note: "Observed in EDOPro with legal-action evidence.",
            legalActionCounts: { normalSummon: 1 },
            legalActions: [{ type: "normalSummon", count: 1 }],
            legalActionGroupCounts: { summon: 1 },
            legalActionGroups: [{ group: "summon", count: 1 }],
          },
          after: {
            source: "edopro",
            note: "Observed in EDOPro without aggregate legal-action counts.",
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--min-action-evidence-percent",
      "75",
      "--min-group-evidence-percent",
      "75",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("EDOPro legal-action evidence: 1 parity files, 2 EDOPro expectation blocks, 1 action evidence blocks, 1 group evidence blocks");
    expect(result.stderr).toContain("Action evidence coverage 50.0% is below required 75.0%");
    expect(result.stderr).toContain("Group evidence coverage 50.0% is below required 75.0%");
  });

  it("fails when positive aggregate counts have empty or zero-only evidence", () => {
    const testRoot = makeTestRoot({
      "parity-empty-evidence.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "EDOPro observed empty evidence should not prove positive counts.",
            legalActionCounts: { normalSummon: 1 },
            legalActions: [],
          },
        });
      `,
      "parity-zero-only-evidence.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "EDOPro observed zero-only evidence should not prove positive counts.",
            legalActionGroupCounts: { summon: 1 },
            legalActionGroups: [{ group: "summon", count: 0 }],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--fail-on-empty",
      "--fail-on-zero-only",
      "--fail-on-zero-evidence",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("EDOPro legal-action evidence: 2 parity files, 2 EDOPro expectation blocks, 1 action evidence blocks, 1 group evidence blocks");
    expect(result.stderr).toContain("Positive aggregate counts with empty legal-action evidence");
    expect(result.stderr).toContain("parity-empty-evidence.test.ts:3");
    expect(result.stderr).toContain("Positive aggregate counts with only zero-count legal-action evidence");
    expect(result.stderr).toContain("parity-zero-only-evidence.test.ts:3");
    expect(result.stderr).toContain("Zero-count legal-action evidence must move to absent expectations");
  });

  it("rejects malformed provenance and legal-action scanner options", () => {
    const missingProvenanceRoot = spawnSync(process.execPath, [provenanceScannerPath, "--test-root"], { encoding: "utf8" });
    const missingProvenanceValue = spawnSync(process.execPath, [provenanceScannerPath, "--min-files"], { encoding: "utf8" });
    const badProvenanceMinimum = spawnSync(process.execPath, [provenanceScannerPath, "--min-files", "-1"], { encoding: "utf8" });
    const unknownProvenanceFlag = spawnSync(process.execPath, [provenanceScannerPath, "--unknown"], { encoding: "utf8" });
    const missingLegalActionRoot = spawnSync(process.execPath, [legalActionScannerPath, "--test-root"], { encoding: "utf8" });
    const missingLegalActionPercent = spawnSync(process.execPath, [legalActionScannerPath, "--min-action-evidence-percent"], { encoding: "utf8" });
    const badLegalActionPercent = spawnSync(process.execPath, [legalActionScannerPath, "--min-action-evidence-percent", "101"], { encoding: "utf8" });
    const unknownLegalActionFlag = spawnSync(process.execPath, [legalActionScannerPath, "--unknown"], { encoding: "utf8" });

    expect(missingProvenanceRoot.status).toBe(1);
    expect(missingProvenanceRoot.stderr).toContain("Missing value for --test-root");
    expect(missingProvenanceValue.status).toBe(1);
    expect(missingProvenanceValue.stderr).toContain("Missing value for --min-files");
    expect(badProvenanceMinimum.status).toBe(1);
    expect(badProvenanceMinimum.stderr).toContain("--min-files must be a non-negative integer");
    expect(unknownProvenanceFlag.status).toBe(1);
    expect(unknownProvenanceFlag.stderr).toContain("Unknown argument: --unknown");
    expect(missingLegalActionRoot.status).toBe(1);
    expect(missingLegalActionRoot.stderr).toContain("Missing value for --test-root");
    expect(missingLegalActionPercent.status).toBe(1);
    expect(missingLegalActionPercent.stderr).toContain("Missing value for --min-action-evidence-percent");
    expect(badLegalActionPercent.status).toBe(1);
    expect(badLegalActionPercent.stderr).toContain("--min-action-evidence-percent must be a percentage from 0 to 100");
    expect(unknownLegalActionFlag.status).toBe(1);
    expect(unknownLegalActionFlag.stderr).toContain("Unknown argument: --unknown");
  });
});

function makeTestRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(systemTmpDir(), "parity-scanner-cli-"));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, name), source);
  return root;
}

function systemTmpDir(): string {
  return fs.realpathSync("/tmp");
}
