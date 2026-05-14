import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const provenanceScannerPath = path.resolve("tools/scan-parity-fixture-provenance.mjs");
const legalActionScannerPath = path.resolve("tools/scan-legal-action-evidence.mjs");

describe("parity scanner CLIs", () => {
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
});

function makeTestRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(systemTmpDir(), "parity-scanner-cli-"));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, name), source);
  return root;
}

function systemTmpDir(): string {
  return fs.realpathSync("/tmp");
}
