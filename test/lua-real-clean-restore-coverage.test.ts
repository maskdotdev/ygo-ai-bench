import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const scannerPath = path.join(root, "tools/scan-lua-clean-restore.mjs");
const realScriptFixtureCount = 496;

describe("Lua real-script clean restore coverage", () => {
  it("requires every real-script fixture to assert no missing Lua registry keys after restore", () => {
    const files = realScriptFixtureFiles();
    expect(files).toHaveLength(realScriptFixtureCount);

    const missing = files.filter((file) => !readTestFile(file).includes("missingRegistryKeys).toEqual([])"));

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
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%)");
    expect(result.stderr).toContain("Real-script fixtures 1 is below required 2");
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
    expect(result.stdout).toContain("Lua real-script clean restore coverage: 1/1 (100.0%), 0 coverage files");
    expect(result.stderr).toContain("Restore coverage files 0 is below required 1");
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
    || file === "lua-chain-limit-restore-coverage.test.ts"
    || file === "lua-grouped-event-restore-coverage.test.ts"
    || file === "lua-source-only-event-coverage.test.ts"
    || file === "lua-event-reason-source-coverage.test.ts",
  );
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}
