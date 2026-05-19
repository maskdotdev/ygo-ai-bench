import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const scannerPath = path.join(root, "tools/scan-lua-clean-restore.mjs");
const realScriptFixtureCount = 787;
const restoreCoverageKindRatchetFileCount = 70;

describe("Lua real-script clean restore coverage", () => {
  it("requires every real-script fixture to assert complete Lua restore diagnostics", () => {
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const missing = files.filter((file) => {
      const text = readTestFile(file);
      return !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")');
    });

    expect(missing).toEqual([]);
  });

  it("requires every real-script fixture to assert no missing Lua registry keys after restore", () => {
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const missing = files.filter((file) => !readTestFile(file).includes("missingRegistryKeys).toEqual([])"));

    expect(missing).toEqual([]);
  });

  it("requires every real-script fixture to assert no missing Lua chain-limit registry keys after restore", () => {
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const missing = files.filter((file) => !readTestFile(file).includes("missingChainLimitRegistryKeys).toEqual([])"));

    expect(missing).toEqual([]);
  });

  it("requires every clean-restored real-script fixture to be owned by a restore coverage guard", () => {
    const referenced = restoreCoverageReferences();
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const unreferenced = files
      .filter((file) => readTestFile(file).includes("missingRegistryKeys).toEqual([])"))
      .filter((file) => !referenced.has(file));

    expect(unreferenced).toEqual([]);
  });

  it("requires every non-aggregate restore coverage guard to ratchet fixture kinds", () => {
    const files = restoreCoverageKindRatchetFiles();
    expect(files).toHaveLength(restoreCoverageKindRatchetFileCount);

    const missing = files.filter((file) => {
      const text = readTestFile(`test/${file}`);
      return !text.includes("Kind")
        || !/kindCounts|KindCounts/.test(text);
    });

    expect(missing).toEqual([]);
  });

  it("requires every Lua-restored real-script fixture to assert raw and grouped legal-action restore evidence", () => {
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const missing = files
      .filter((file) => readTestFile(file).includes("restoreDuelWithLuaScripts"))
      .filter((file) => {
        const text = readTestFile(file);
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !hasRestoredLegalActionFlattenAssertion(text);
      });

    expect(missing).toEqual([]);
  });

  it("fails the scanner when the real-script fixture corpus is below the required floor", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), "expect(missingRegistryKeys).toEqual([]);");

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--min-percent",
      "100",
      "--min-fixtures",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), chain-limit 0/1");
    expect(result.stderr).toContain("Real-script fixtures 1 is below required 2");
  });

  it("fails the scanner when a real-script fixture lacks chain-limit clean restore assertions", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), "expect(missingRegistryKeys).toEqual([]);");

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--min-percent",
      "100",
      "--fail-on-missing",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), chain-limit 0/1");
    expect(result.stderr).toContain("Fixtures missing chain-limit clean restore assertions:");
    expect(result.stderr).toContain("lua-real-script-small.test.ts");
  });

  it("fails the scanner when a real-script fixture lacks complete restore diagnostics", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), [
      "expect(missingRegistryKeys).toEqual([]);",
      "expect(missingChainLimitRegistryKeys).toEqual([]);",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--fail-on-missing-diagnostics",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), chain-limit 1/1, diagnostics 0/1");
    expect(result.stderr).toContain("Fixtures missing complete restore diagnostics:");
    expect(result.stderr).toContain("lua-real-script-small.test.ts");
  });

  it("fails the scanner when a real-script fixture lacks restored legal-action evidence", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), [
      "expect(restored.restoreComplete).toBe(true);",
      'expect(restored.incompleteReasons.join("; ")).toBe("");',
      "expect(missingRegistryKeys).toEqual([]);",
      "expect(missingChainLimitRegistryKeys).toEqual([]);",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--fail-on-missing-legal-actions",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), chain-limit 1/1, diagnostics 1/1, legal-actions 0/1");
    expect(result.stderr).toContain("Fixtures missing restored legal-action evidence:");
    expect(result.stderr).toContain("lua-real-script-small.test.ts");
  });

  it("fails the scanner when restored legal-action evidence lacks a flatten equality assertion", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), [
      "expect(restored.restoreComplete, restored.incompleteReasons.join(\"; \")).toBe(true);",
      "expect(missingRegistryKeys).toEqual([]);",
      "expect(missingChainLimitRegistryKeys).toEqual([]);",
      "expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));",
      "expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));",
      "expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toHaveLength(1);",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--fail-on-missing-legal-actions",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("legal-actions 0/1");
    expect(result.stderr).toContain("Fixtures missing restored legal-action evidence:");
    expect(result.stderr).toContain("lua-real-script-small.test.ts");
  });

  it("fails the scanner when the restore coverage-file corpus is below the required floor", () => {
    const testRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "lua-clean-restore-cli-"));
    fs.writeFileSync(path.join(testRoot, "lua-real-script-small.test.ts"), "expect(missingRegistryKeys).toEqual([]);");

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--test-root",
      testRoot,
      "--min-coverage-files",
      "1",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), chain-limit 0/1, diagnostics 0/1, legal-actions 0/1, 0 coverage files");
    expect(result.stderr).toContain("Restore coverage files 0 is below required 1");
  });

  it("rejects malformed scanner options", () => {
    const cases = [
      { args: ["--test-root"], error: "Missing value for --test-root" },
      { args: ["--min-percent", "101"], error: "Invalid --min-percent value: 101" },
      { args: ["--min-fixtures", "-1"], error: "--min-fixtures must be a non-negative integer" },
      { args: ["--min-coverage-files", "1.5"], error: "--min-coverage-files must be a non-negative integer" },
      { args: ["--unknown"], error: "Unknown argument: --unknown" },
    ];

    for (const { args, error } of cases) {
      const result = spawnSync(process.execPath, [scannerPath, ...args], { encoding: "utf8" });

      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr).toContain(error);
    }
  });
});

function realScriptFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-real-script-.*\.test\.ts$/.test(file))
    .map((file) => `test/${file}`)
    .sort();
}

function restoreCoverageReferences(): Set<string> {
  const references = new Set<string>();
  for (const file of restoreCoverageFiles()) {
    const text = readTestFile(`test/${file}`);
    for (const match of text.matchAll(/(?:file:\s*)?["']((?:test\/)?lua-real-script-[^"']+\.test\.ts)["']/g)) {
      const fixture = match[1]!.startsWith("test/") ? match[1]! : `test/${match[1]}`;
      references.add(fixture);
    }
  }
  for (const file of realScriptFixtureFiles().filter((fixture) => /chain-limit/.test(fixture))) {
    references.add(file);
  }
  return references;
}

function restoreCoverageFiles(): string[] {
  return fs.readdirSync(path.join(root, "test")).filter((file) =>
    /^lua-real-.*restore-coverage\.test\.ts$/.test(file)
    || /^lua-real-.*restore-(?:fixtures|variants)\.ts$/.test(file)
    || file === "lua-chain-limit-restore-coverage.test.ts"
    || file === "lua-grouped-event-restore-coverage.test.ts"
    || file === "lua-source-only-event-coverage.test.ts"
    || file === "lua-event-reason-source-coverage.test.ts",
  );
}

function restoreCoverageKindRatchetFiles(): string[] {
  return restoreCoverageFiles()
    .filter((file) =>
      /^lua-real-.*restore-coverage\.test\.ts$/.test(file)
      && file !== "lua-real-clean-restore-coverage.test.ts"
    )
    .sort();
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function hasRestoredLegalActionFlattenAssertion(text: string): boolean {
  return /flatMap\(\(group\) => group\.actions\)\)\.toEqual\([\s\S]*?(?:getLuaRestoreLegalActions|\b(?:actions|response|result|changed|summoned)\.legalActions|\bactions\b)[\s\S]*?\);/.test(text);
}
