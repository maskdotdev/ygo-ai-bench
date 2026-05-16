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
      "--min-restored-before-blocks",
      "1",
      "--min-restored-after-blocks",
      "1",
      "--min-restored-window-blocks",
      "2",
      "--min-final-expected-blocks",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Parity fixture provenance: 1 files, 1 expectation blocks, 1 EDOPro, 0 backlog, 0 restored scripted fixtures, 0 restored before blocks, 0 restored after blocks, 0 restored window blocks, 1 final expected blocks");
    expect(result.stderr).toContain("Parity fixture files 1 is below required 2");
    expect(result.stderr).toContain("Expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("EDOPro expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("Restored scripted fixtures 0 is below required 2");
    expect(result.stderr).toContain("Restored before blocks 0 is below required 1");
    expect(result.stderr).toContain("Restored after blocks 0 is below required 1");
    expect(result.stderr).toContain("Restored window blocks 0 is below required 2");
    expect(result.stderr).toContain("Final expected blocks 1 is below required 2");
  });

  it("counts EDOPro final expected blocks", () => {
    const testRoot = makeTestRoot({
      "parity-final-expected-blocks.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "edopro",
            note: "EDOPro observed the final state.",
          },
        });
      `,
      "parity-backlog-final-expected-block.test.ts": `
        runScriptedDuelFixture({
          expected: {
            source: "parity-backlog",
            note: "EDOPro observation is still pending.",
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--min-final-expected-blocks",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 files, 2 expectation blocks, 1 EDOPro, 1 backlog");
    expect(result.stdout).toContain("1 final expected blocks");
    expect(result.stderr).toContain("Final expected blocks 1 is below required 2");
  });

  it("counts before and after EDOPro blocks with matching snapshot restore coverage", () => {
    const testRoot = makeTestRoot({
      "parity-restored-window-blocks.test.ts": `
        runScriptedDuelFixture({
          responses: [
            makeScriptedStep(makeResponseSelector("pass", 0), {
              snapshotRestore: "both",
              before: {
                source: "edopro",
                note: "EDOPro observed the pre-action window.",
              },
              after: {
                source: "edopro",
                note: "EDOPro observed the post-action window.",
              },
            }),
            makeScriptedStep(makeResponseSelector("pass", 1), {
              snapshotRestore: "before",
              before: {
                source: "edopro",
                note: "EDOPro observed the second pre-action window.",
              },
              after: {
                source: "edopro",
                note: "EDOPro observed the unrestored post-action window.",
              },
            }),
          ],
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--min-restored-before-blocks",
      "2",
      "--min-restored-after-blocks",
      "2",
      "--min-restored-window-blocks",
      "4",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 restored before blocks, 1 restored after blocks, 3 restored window blocks");
    expect(result.stderr).toContain("Restored after blocks 1 is below required 2");
    expect(result.stderr).toContain("Restored window blocks 3 is below required 4");
  });

  it("bounds unrestored EDOPro after blocks to documented exceptions", () => {
    const testRoot = makeTestRoot({
      "parity-unrestored-after-blocks.test.ts": `
        runScriptedDuelFixture({
          responses: [
            makeScriptedStep(makeResponseSelector("pass", 0), {
              after: {
                source: "edopro",
                note: "EDOPro observed this ordinary unrestored post-action window.",
              },
            }),
            makeScriptedStep(makeResponseSelector("pass", 1), {
              after: {
                source: "edopro",
                note: "EDOPro observed this intentionally wrong exception.",
              },
            }),
          ],
        });
      `,
    });

    const tooMany = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--max-unrestored-after-blocks",
      "1",
    ], { encoding: "utf8" });
    const missingExceptionNote = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--require-unrestored-after-note",
      "intentionally wrong",
    ], { encoding: "utf8" });

    expect(tooMany.status).toBe(1);
    expect(tooMany.stderr).toContain("Unrestored EDOPro after blocks 2 exceeds allowed 1");
    expect(tooMany.stderr).toContain("parity-unrestored-after-blocks.test.ts:5");
    expect(tooMany.stderr).toContain("parity-unrestored-after-blocks.test.ts:11");
    expect(missingExceptionNote.status).toBe(1);
    expect(missingExceptionNote.stderr).toContain('Unrestored EDOPro after blocks must include note text "intentionally wrong"');
    expect(missingExceptionNote.stderr).toContain("parity-unrestored-after-blocks.test.ts:5");
    expect(missingExceptionNote.stderr).not.toContain("parity-unrestored-after-blocks.test.ts:11");
  });

  it("bounds unrestored EDOPro before blocks", () => {
    const testRoot = makeTestRoot({
      "parity-unrestored-before-blocks.test.ts": `
        runScriptedDuelFixture({
          responses: [
            makeScriptedStep(makeResponseSelector("pass", 0), {
              before: {
                source: "edopro",
                note: "EDOPro observed this unrestored pre-action window.",
              },
            }),
            makeScriptedStep(makeResponseSelector("pass", 1), {
              snapshotRestore: "both",
              before: {
                source: "edopro",
                note: "EDOPro observed this restored pre-action window.",
              },
            }),
          ],
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--max-unrestored-before-blocks",
      "0",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 expectation blocks, 2 EDOPro");
    expect(result.stdout).toContain("1 restored before blocks");
    expect(result.stderr).toContain("Unrestored EDOPro before blocks 1 exceeds allowed 0");
    expect(result.stderr).toContain("parity-unrestored-before-blocks.test.ts:5");
    expect(result.stderr).not.toContain("parity-unrestored-before-blocks.test.ts:12");
  });

  it("bounds after-only restore steps", () => {
    const testRoot = makeTestRoot({
      "parity-after-only-restore.test.ts": `
        runScriptedDuelFixture({
          responses: [
            makeScriptedStep(makeResponseSelector("pass", 0), {
              snapshotRestore: "after",
              after: {
                source: "edopro",
                note: "EDOPro observed this after-only restored window.",
              },
            }),
            makeScriptedStep(makeResponseSelector("pass", 1), {
              snapshotRestore: "both",
              after: {
                source: "edopro",
                note: "EDOPro observed this fully restored window.",
              },
            }),
          ],
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      provenanceScannerPath,
      "--test-root",
      testRoot,
      "--max-after-only-restore-steps",
      "0",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 restored after blocks, 2 restored window blocks, 0 final expected blocks, 1 after-only restore steps");
    expect(result.stderr).toContain("After-only restore steps 1 exceeds allowed 0");
    expect(result.stderr).toContain("parity-after-only-restore.test.ts:5");
    expect(result.stderr).not.toContain("parity-after-only-restore.test.ts:12");
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
      "--min-window-evidence-blocks",
      "2",
      "--min-top-level-window-evidence-blocks",
      "1",
      "--min-absent-action-evidence-blocks",
      "1",
      "--min-absent-group-evidence-blocks",
      "1",
      "--min-paired-absent-evidence-blocks",
      "1",
      "--min-action-evidence-percent",
      "100",
      "--min-group-evidence-percent",
      "100",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("EDOPro legal-action evidence: 1 parity files, 1 EDOPro expectation blocks, 1 action evidence blocks, 1 group evidence blocks, 0 window evidence blocks, 0 top-level window evidence blocks");
    expect(result.stderr).toContain("Parity fixture files 1 is below required 2");
    expect(result.stderr).toContain("EDOPro expectation blocks 1 is below required 2");
    expect(result.stderr).toContain("Action evidence blocks 1 is below required 2");
    expect(result.stderr).toContain("Group evidence blocks 1 is below required 2");
    expect(result.stderr).toContain("Window evidence blocks 0 is below required 2");
    expect(result.stderr).toContain("Top-level window evidence blocks 0 is below required 1");
    expect(result.stderr).toContain("Absent action evidence blocks 0 is below required 1");
    expect(result.stderr).toContain("Absent group evidence blocks 0 is below required 1");
    expect(result.stderr).toContain("Paired absent evidence blocks 0 is below required 1");
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

  it("fails when EDOPro evidence omits window IDs or kinds", () => {
    const testRoot = makeTestRoot({
      "parity-missing-window-evidence.test.ts": `
        runScriptedDuelFixture({
          before: {
            source: "edopro",
            note: "EDOPro observed actions without explicit window evidence.",
            legalActionCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "normalSummon", player: 0, count: 1 }],
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActionGroups: [{ player: 0, label: "Summons", count: 1 }],
          },
          after: {
            source: "edopro",
            note: "EDOPro observed actions with explicit window evidence.",
            windowId: 1,
            windowKind: "open",
            legalActionCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 }],
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActionGroups: [{ player: 0, label: "Turn", windowId: 1, windowKind: "open", count: 1 }],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--min-window-evidence-blocks",
      "2",
      "--fail-on-missing-window-evidence",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 EDOPro expectation blocks, 2 action evidence blocks, 2 group evidence blocks, 1 window evidence blocks");
    expect(result.stderr).toContain("Window evidence blocks 1 is below required 2");
    expect(result.stderr).toContain("EDOPro blocks missing windowId/windowKind evidence");
    expect(result.stderr).toContain("parity-missing-window-evidence.test.ts:3");
    expect(result.stderr).not.toContain("parity-missing-window-evidence.test.ts:11");
  });

  it("counts top-level window evidence separately from nested action evidence", () => {
    const testRoot = makeTestRoot({
      "parity-top-level-window-evidence.test.ts": `
        runScriptedDuelFixture({
          before: {
            source: "edopro",
            note: "EDOPro observed nested action window evidence without top-level public window fields.",
            legalActionCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "normalSummon", player: 0, windowId: 1, windowKind: "open", count: 1 }],
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActionGroups: [{ player: 0, label: "Summons", windowId: 1, windowKind: "open", count: 1 }],
          },
          after: {
            source: "edopro",
            note: "EDOPro observed top-level public window fields.",
            windowId: 2,
            windowKind: "open",
            legalActionCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 }],
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActionGroups: [{ player: 0, label: "Turn", windowId: 2, windowKind: "open", count: 1 }],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--min-window-evidence-blocks",
      "2",
      "--min-top-level-window-evidence-blocks",
      "2",
      "--fail-on-missing-top-level-window-evidence",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 window evidence blocks, 1 top-level window evidence blocks");
    expect(result.stderr).not.toContain("Window evidence blocks 2 is below required 2");
    expect(result.stderr).toContain("Top-level window evidence blocks 1 is below required 2");
    expect(result.stderr).toContain("EDOPro blocks missing top-level windowId/windowKind evidence");
    expect(result.stderr).toContain("parity-top-level-window-evidence.test.ts:3");
    expect(result.stderr).not.toContain("parity-top-level-window-evidence.test.ts:11");
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

  it("fails when absent raw and grouped legal-action evidence is unpaired", () => {
    const testRoot = makeTestRoot({
      "parity-unpaired-absent-evidence.test.ts": `
        runScriptedDuelFixture({
          before: {
            source: "edopro",
            note: "EDOPro observed raw absent evidence without grouped evidence.",
            absentLegalActions: [{ type: "activateEffect", player: 0 }],
          },
          after: {
            source: "edopro",
            note: "EDOPro observed grouped absent evidence without raw evidence.",
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [] }],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--fail-on-unpaired-absent",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Absent legal-action evidence must include both raw and grouped assertions");
    expect(result.stderr).toContain("parity-unpaired-absent-evidence.test.ts:3");
    expect(result.stderr).toContain("parity-unpaired-absent-evidence.test.ts:8");
  });

  it("fails when absent legal-action evidence arrays are empty", () => {
    const testRoot = makeTestRoot({
      "parity-empty-absent-evidence.test.ts": `
        runScriptedDuelFixture({
          before: {
            source: "edopro",
            note: "EDOPro observed an empty raw absent evidence list.",
            absentLegalActions: [],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0 }] }],
          },
          after: {
            source: "edopro",
            note: "EDOPro observed an empty grouped absent evidence list.",
            absentLegalActions: [{ type: "activateEffect", player: 0 }],
            absentLegalActionGroups: [],
          },
        });
      `,
    });

    const result = spawnSync(process.execPath, [
      legalActionScannerPath,
      "--test-root",
      testRoot,
      "--fail-on-empty-absent",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Absent legal-action evidence arrays must not be empty");
    expect(result.stderr).toContain("parity-empty-absent-evidence.test.ts:3");
    expect(result.stderr).toContain("parity-empty-absent-evidence.test.ts:9");
  });

  it("rejects malformed provenance and legal-action scanner options", () => {
    const missingProvenanceRoot = spawnSync(process.execPath, [provenanceScannerPath, "--test-root"], { encoding: "utf8" });
    const missingProvenanceValue = spawnSync(process.execPath, [provenanceScannerPath, "--min-files"], { encoding: "utf8" });
    const badProvenanceMinimum = spawnSync(process.execPath, [provenanceScannerPath, "--min-files", "-1"], { encoding: "utf8" });
    const missingProvenanceExpectedValue = spawnSync(process.execPath, [provenanceScannerPath, "--min-final-expected-blocks"], { encoding: "utf8" });
    const missingProvenanceBeforeValue = spawnSync(process.execPath, [provenanceScannerPath, "--max-unrestored-before-blocks"], { encoding: "utf8" });
    const missingProvenanceAfterOnlyValue = spawnSync(process.execPath, [provenanceScannerPath, "--max-after-only-restore-steps"], { encoding: "utf8" });
    const unknownProvenanceFlag = spawnSync(process.execPath, [provenanceScannerPath, "--unknown"], { encoding: "utf8" });
    const missingLegalActionRoot = spawnSync(process.execPath, [legalActionScannerPath, "--test-root"], { encoding: "utf8" });
    const missingLegalActionPercent = spawnSync(process.execPath, [legalActionScannerPath, "--min-action-evidence-percent"], { encoding: "utf8" });
    const missingLegalActionWindowValue = spawnSync(process.execPath, [legalActionScannerPath, "--min-window-evidence-blocks"], { encoding: "utf8" });
    const missingLegalActionTopLevelWindowValue = spawnSync(process.execPath, [legalActionScannerPath, "--min-top-level-window-evidence-blocks"], { encoding: "utf8" });
    const badLegalActionPercent = spawnSync(process.execPath, [legalActionScannerPath, "--min-action-evidence-percent", "101"], { encoding: "utf8" });
    const unknownLegalActionFlag = spawnSync(process.execPath, [legalActionScannerPath, "--unknown"], { encoding: "utf8" });

    expect(missingProvenanceRoot.status).toBe(1);
    expect(missingProvenanceRoot.stderr).toContain("Missing value for --test-root");
    expect(missingProvenanceValue.status).toBe(1);
    expect(missingProvenanceValue.stderr).toContain("Missing value for --min-files");
    expect(badProvenanceMinimum.status).toBe(1);
    expect(badProvenanceMinimum.stderr).toContain("--min-files must be a non-negative integer");
    expect(missingProvenanceExpectedValue.status).toBe(1);
    expect(missingProvenanceExpectedValue.stderr).toContain("Missing value for --min-final-expected-blocks");
    expect(missingProvenanceBeforeValue.status).toBe(1);
    expect(missingProvenanceBeforeValue.stderr).toContain("Missing value for --max-unrestored-before-blocks");
    expect(missingProvenanceAfterOnlyValue.status).toBe(1);
    expect(missingProvenanceAfterOnlyValue.stderr).toContain("Missing value for --max-after-only-restore-steps");
    expect(unknownProvenanceFlag.status).toBe(1);
    expect(unknownProvenanceFlag.stderr).toContain("Unknown argument: --unknown");
    expect(missingLegalActionRoot.status).toBe(1);
    expect(missingLegalActionRoot.stderr).toContain("Missing value for --test-root");
    expect(missingLegalActionPercent.status).toBe(1);
    expect(missingLegalActionPercent.stderr).toContain("Missing value for --min-action-evidence-percent");
    expect(missingLegalActionWindowValue.status).toBe(1);
    expect(missingLegalActionWindowValue.stderr).toContain("Missing value for --min-window-evidence-blocks");
    expect(missingLegalActionTopLevelWindowValue.status).toBe(1);
    expect(missingLegalActionTopLevelWindowValue.stderr).toContain("Missing value for --min-top-level-window-evidence-blocks");
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
